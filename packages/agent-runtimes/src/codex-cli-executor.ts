import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  AgentExecutionEventSchema,
  AgentExecutionInputSchema,
  AgentNodeResultSchema,
  type AgentCancelResult,
  type AgentExecutionEvent,
  type AgentExecutionId,
  type AgentExecutionInput,
  type AgentExecutor,
  type AgentNodeResult,
} from './contract.js'
import { createCodexEventNormalizer, type CodexEventNormalizer } from './codex-event-normalizer.js'
import { decodeJsonLines } from './json-lines.js'
import { createEventRedactor, redactAgentNodeResult } from './redaction.js'
import { sensitiveEnvironmentValues } from './sensitive-environment.js'

const MAX_COMPLETION_RESULT_BYTES = 262_144

export interface CodexCliSpawnInput {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<NodeJS.ProcessEnv>
}

export interface CodexCliProcessExit {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

export interface CodexCliProcess {
  readonly stdout: AsyncIterable<string | Uint8Array>
  readonly stderr: AsyncIterable<string | Uint8Array>
  readonly exited: Promise<CodexCliProcessExit>
  write(content: string): void
  end(): void
  kill(signal: NodeJS.Signals): boolean
}

export interface CodexCliProcessSpawner {
  spawn(input: CodexCliSpawnInput): CodexCliProcess
}

export interface CreateCodexCliAgentExecutorOptions {
  readonly executablePath?: string
  readonly processSpawner?: CodexCliProcessSpawner
  readonly env?: Readonly<NodeJS.ProcessEnv>
  readonly now?: () => number
  readonly terminationGraceMs?: number
  readonly forceKillGraceMs?: number
}

interface ActiveExecution {
  readonly process: CodexCliProcess
  readonly cancelled: Promise<void>
  readonly resolveCancelled: () => void
  cancelRequested: boolean
  stopPromise: Promise<boolean> | undefined
}

class CodexExecutionError extends Error {
  override readonly name = 'CodexExecutionError'

  constructor(
    readonly code:
      | 'AGENT_SESSION_FAILED'
      | 'AGENT_TIMEOUT'
      | 'COMPLETION_INPUT_INVALID'
      | 'COMPLETION_MISSING'
      | 'COMPLETION_OUTCOME_UNDECLARED'
      | 'COMPLETION_RESULT_TOO_LARGE'
      | 'HARNESS_PROCESS_EXITED'
      | 'HARNESS_PROTOCOL_FAILED',
    message: string,
  ) {
    super(message)
  }
}

const failureMessages = {
  AGENT_SESSION_FAILED: 'Codex agent session failed',
  AGENT_TIMEOUT: 'Agent execution timed out',
  COMPLETION_INPUT_INVALID: 'Codex returned an invalid node result',
  COMPLETION_MISSING: 'Codex finished without a node result',
  COMPLETION_OUTCOME_UNDECLARED: 'Codex returned an undeclared node outcome',
  COMPLETION_RESULT_TOO_LARGE: 'Codex returned a node result that is too large',
  HARNESS_PROCESS_EXITED: 'Codex exited before completing the node',
  HARNESS_PROTOCOL_FAILED: 'Codex JSONL protocol failed',
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const delay = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

const waitForExit = async (process: CodexCliProcess, milliseconds: number): Promise<boolean> => {
  try {
    return await Promise.race([
      process.exited.then(() => true),
      delay(milliseconds).then(() => false),
    ])
  } catch {
    return true
  }
}

export const createNodeCodexCliProcessSpawner = (): CodexCliProcessSpawner => ({
  spawn(input) {
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: { ...input.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const exited = new Promise<CodexCliProcessExit>((resolve) => {
      child.once('error', () => resolve({ exitCode: null, signal: null }))
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
    })
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      exited,
      write(content) {
        if (!child.stdin.write(content)) {
          // Node preserves write order while it waits for the stream to drain.
        }
      },
      end() {
        child.stdin.end()
      },
      kill(signal) {
        return child.kill(signal)
      },
    }
  },
})

const drain = async (source: AsyncIterable<string | Uint8Array>): Promise<void> => {
  for await (const chunk of source) {
    void chunk
    // Draining stderr prevents a blocked child. Provider errors stay private.
  }
}

const createActiveExecution = (process: CodexCliProcess): ActiveExecution => {
  let resolveCancelled: () => void = () => undefined
  const cancelled = new Promise<void>((resolve) => {
    resolveCancelled = resolve
  })
  return {
    process,
    cancelled,
    resolveCancelled,
    cancelRequested: false,
    stopPromise: undefined,
  }
}

const stopProcess = (
  active: ActiveExecution,
  options: { readonly terminationGraceMs: number; readonly forceKillGraceMs: number },
): Promise<boolean> => {
  if (active.stopPromise !== undefined) return active.stopPromise
  active.stopPromise = (async () => {
    if (await waitForExit(active.process, 0)) return true
    try {
      active.process.kill('SIGTERM')
    } catch {
      // Continue to the final bounded SIGKILL attempt.
    }
    if (await waitForExit(active.process, options.terminationGraceMs)) return true
    try {
      active.process.kill('SIGKILL')
    } catch {
      return false
    }
    return waitForExit(active.process, options.forceKillGraceMs)
  })()
  return active.stopPromise
}

const completionSchema = (input: AgentExecutionInput): Readonly<Record<string, unknown>> => ({
  type: 'object',
  properties: {
    outcome: { type: 'string', enum: input.declaredOutcomes },
    summary: { type: 'string', minLength: 1, maxLength: 4_096 },
    data: {
      type: 'string',
      description: 'A JSON-encoded value containing the structured node result data.',
    },
    evidence: {
      type: 'array',
      maxItems: 128,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['command', 'test', 'file', 'url', 'note'] },
          value: { type: 'string', minLength: 1, maxLength: 16_384 },
        },
        required: ['kind', 'value'],
        additionalProperties: false,
      },
    },
  },
  required: ['outcome', 'summary', 'data', 'evidence'],
  additionalProperties: false,
})

const prompt = (input: AgentExecutionInput): string => {
  const repositories = input.workspace.repositories.map(({ repositoryId, path }) => ({
    repositoryId,
    path,
    primary: repositoryId === input.workspace.primaryRepositoryId,
  }))
  return `${input.renderedPrompt}\n\n<slopify_execution_protocol>\nRun repositories: ${JSON.stringify(repositories)}\nRun artifacts: ${input.artifactsPath}\nComplete all work inside these run workspaces. Your final response must match the provided JSON Schema with exactly one of these declared outcomes: ${input.declaredOutcomes.join(', ')}. Encode the data field as a JSON string. Omit evidence entries whose value would be empty. Do not finish without returning that structured node result.\n</slopify_execution_protocol>`
}

const usage = (event: Record<string, unknown>) => {
  const empty = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const rawUsage = event.usage
  if (!isRecord(rawUsage)) return empty
  const value = (key: string): number => {
    const candidate = rawUsage[key]
    return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0
      ? candidate
      : 0
  }
  return {
    inputTokens: value('input_tokens'),
    outputTokens: value('output_tokens'),
    cacheReadTokens: value('cached_input_tokens'),
    cacheWriteTokens: 0,
  }
}

const nextRecord = async (iterator: AsyncIterator<unknown>): Promise<IteratorResult<unknown>> => {
  try {
    return await iterator.next()
  } catch {
    throw new CodexExecutionError(
      'HARNESS_PROTOCOL_FAILED',
      failureMessages.HARNESS_PROTOCOL_FAILED,
    )
  }
}

const parseCompletion = (
  message: string | undefined,
  input: AgentExecutionInput,
): AgentNodeResult => {
  if (message === undefined) {
    throw new CodexExecutionError('COMPLETION_MISSING', failureMessages.COMPLETION_MISSING)
  }
  let candidate: unknown
  try {
    candidate = JSON.parse(message) as unknown
  } catch {
    throw new CodexExecutionError(
      'COMPLETION_INPUT_INVALID',
      failureMessages.COMPLETION_INPUT_INVALID,
    )
  }
  if (!isRecord(candidate) || typeof candidate.data !== 'string') {
    throw new CodexExecutionError(
      'COMPLETION_INPUT_INVALID',
      failureMessages.COMPLETION_INPUT_INVALID,
    )
  }
  try {
    candidate = { ...candidate, data: JSON.parse(candidate.data) as unknown }
  } catch {
    throw new CodexExecutionError(
      'COMPLETION_INPUT_INVALID',
      failureMessages.COMPLETION_INPUT_INVALID,
    )
  }
  const parsed = AgentNodeResultSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new CodexExecutionError(
      'COMPLETION_INPUT_INVALID',
      failureMessages.COMPLETION_INPUT_INVALID,
    )
  }
  if (!input.declaredOutcomes.includes(parsed.data.outcome)) {
    throw new CodexExecutionError(
      'COMPLETION_OUTCOME_UNDECLARED',
      failureMessages.COMPLETION_OUTCOME_UNDECLARED,
    )
  }
  if (
    new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength > MAX_COMPLETION_RESULT_BYTES
  ) {
    throw new CodexExecutionError(
      'COMPLETION_RESULT_TOO_LARGE',
      failureMessages.COMPLETION_RESULT_TOO_LARGE,
    )
  }
  return parsed.data
}

export const createCodexCliAgentExecutor = (
  options: CreateCodexCliAgentExecutorOptions = {},
): AgentExecutor => {
  const executablePath = options.executablePath ?? 'codex'
  const processSpawner = options.processSpawner ?? createNodeCodexCliProcessSpawner()
  const now = options.now ?? Date.now
  const terminationOptions = {
    terminationGraceMs: options.terminationGraceMs ?? 500,
    forceKillGraceMs: options.forceKillGraceMs ?? 2_000,
  }
  const activeExecutions = new Map<AgentExecutionId, ActiveExecution>()

  const createEvent = (
    input: AgentExecutionInput,
    type: AgentExecutionEvent['type'],
    data: unknown,
  ): AgentExecutionEvent =>
    AgentExecutionEventSchema.parse({
      executionId: input.executionId,
      runId: input.runId,
      nodeId: input.nodeId,
      timestamp: new Date(now()).toISOString(),
      type,
      data,
    })

  return {
    async *execute(unparsedInput) {
      const input = AgentExecutionInputSchema.parse(unparsedInput)
      const startedAt = now()
      const durationMs = (): number => Math.max(0, now() - startedAt)
      let active: ActiveExecution | undefined
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      let stderrDrain: Promise<void> | undefined
      let schemaDirectory: string | undefined

      yield createEvent(input, 'AGENT_STARTED', {})

      try {
        if (activeExecutions.has(input.executionId)) {
          throw new CodexExecutionError(
            'AGENT_SESSION_FAILED',
            failureMessages.AGENT_SESSION_FAILED,
          )
        }
        const primary = input.workspace.repositories.find(
          ({ repositoryId }) => repositoryId === input.workspace.primaryRepositoryId,
        )
        if (primary === undefined) {
          throw new CodexExecutionError(
            'AGENT_SESSION_FAILED',
            failureMessages.AGENT_SESSION_FAILED,
          )
        }

        const environment = options.env ?? processEnv()
        const redactor = createEventRedactor({
          sensitiveValues: sensitiveEnvironmentValues(environment),
        })
        const normalizer: CodexEventNormalizer = createCodexEventNormalizer({ redactor })
        schemaDirectory = await mkdtemp(join(tmpdir(), 'slopify-codex-'))
        const schemaPath = join(schemaDirectory, 'node-result.schema.json')
        await writeFile(schemaPath, JSON.stringify(completionSchema(input)), { mode: 0o600 })
        const args = [
          'exec',
          '--ephemeral',
          '--json',
          '--color',
          'never',
          '--sandbox',
          'workspace-write',
          ...input.workspace.repositories.flatMap((repository) =>
            repository.repositoryId === input.workspace.primaryRepositoryId
              ? []
              : ['--add-dir', repository.path],
          ),
          '--add-dir',
          input.artifactsPath,
          '--output-schema',
          schemaPath,
          ...(input.model === undefined ? [] : ['--model', input.model]),
          ...(input.thinkingLevel === undefined
            ? []
            : ['-c', `model_reasoning_effort="${input.thinkingLevel}"`]),
          '-',
        ]
        const process = processSpawner.spawn({
          executable: executablePath,
          args,
          cwd: primary.path,
          env: environment,
        })
        active = createActiveExecution(process)
        activeExecutions.set(input.executionId, active)
        stderrDrain = drain(process.stderr)
        process.write(prompt(input))
        process.end()

        let resolveTimeout: () => void = () => undefined
        const timedOut = new Promise<void>((resolve) => {
          resolveTimeout = resolve
        })
        timeoutId = setTimeout(resolveTimeout, input.timeoutSeconds * 1_000)
        const termination = Promise.race([
          active.cancelled.then(() => 'cancelled' as const),
          timedOut.then(() => 'timeout' as const),
        ])
        const iterator = decodeJsonLines(process.stdout)[Symbol.asyncIterator]()
        let finalMessage: string | undefined
        let finalUsage = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }
        let turnCompleted = false

        for (;;) {
          const pendingRecord = nextRecord(iterator)
          const next = await Promise.race([
            pendingRecord.then((record) => ({ kind: 'record' as const, record })),
            termination.then((kind) => ({ kind })),
          ])
          if (next.kind !== 'record') {
            await stopProcess(active, terminationOptions)
            await pendingRecord.catch(() => undefined)
            if (next.kind === 'timeout') {
              throw new CodexExecutionError('AGENT_TIMEOUT', failureMessages.AGENT_TIMEOUT)
            }
            throw new CodexExecutionError(
              'AGENT_SESSION_FAILED',
              failureMessages.AGENT_SESSION_FAILED,
            )
          }
          if (next.record.done) break
          const raw = next.record.value
          if (!isRecord(raw) || typeof raw.type !== 'string') {
            throw new CodexExecutionError(
              'HARNESS_PROTOCOL_FAILED',
              failureMessages.HARNESS_PROTOCOL_FAILED,
            )
          }
          for (const event of normalizer.normalize(raw))
            yield createEvent(input, event.type, event.data)

          if (raw.type === 'thread.started') {
            if (typeof raw.thread_id !== 'string') {
              throw new CodexExecutionError(
                'HARNESS_PROTOCOL_FAILED',
                failureMessages.HARNESS_PROTOCOL_FAILED,
              )
            }
            yield createEvent(input, 'AGENT_SESSION_IDENTIFIED', { sessionId: raw.thread_id })
          } else if (raw.type === 'item.completed' && isRecord(raw.item)) {
            if (raw.item.type === 'agent_message' && typeof raw.item.text === 'string') {
              finalMessage = raw.item.text
            }
          } else if (raw.type === 'turn.completed') {
            if (turnCompleted) {
              throw new CodexExecutionError(
                'HARNESS_PROTOCOL_FAILED',
                failureMessages.HARNESS_PROTOCOL_FAILED,
              )
            }
            turnCompleted = true
            finalUsage = usage(raw)
          } else if (raw.type === 'turn.failed' || raw.type === 'error') {
            throw new CodexExecutionError(
              'AGENT_SESSION_FAILED',
              failureMessages.AGENT_SESSION_FAILED,
            )
          }
        }

        const exit = await Promise.race([
          process.exited.then((value) => ({ kind: 'exit' as const, value })),
          termination.then((kind) => ({ kind })),
        ])
        if (exit.kind !== 'exit') {
          if (exit.kind === 'timeout') {
            throw new CodexExecutionError('AGENT_TIMEOUT', failureMessages.AGENT_TIMEOUT)
          }
          throw new CodexExecutionError(
            'AGENT_SESSION_FAILED',
            failureMessages.AGENT_SESSION_FAILED,
          )
        }
        if (exit.value.exitCode !== 0 || !turnCompleted) {
          throw new CodexExecutionError(
            'HARNESS_PROCESS_EXITED',
            failureMessages.HARNESS_PROCESS_EXITED,
          )
        }
        const result = redactAgentNodeResult(parseCompletion(finalMessage, input), redactor)
        yield createEvent(input, 'AGENT_RESULT', {
          result,
          usage: finalUsage,
          durationMs: durationMs(),
        })
      } catch (cause) {
        if (active?.cancelRequested === true) {
          await stopProcess(active, terminationOptions)
          yield createEvent(input, 'AGENT_CANCELLED', {
            reason: 'Agent execution was cancelled',
            durationMs: durationMs(),
          })
        } else {
          const failure =
            cause instanceof CodexExecutionError
              ? cause
              : new CodexExecutionError(
                  'AGENT_SESSION_FAILED',
                  failureMessages.AGENT_SESSION_FAILED,
                )
          if (failure.code === 'AGENT_TIMEOUT' && active !== undefined) {
            await stopProcess(active, terminationOptions)
          }
          yield createEvent(input, 'AGENT_FAILED', {
            code: failure.code,
            message: failure.message,
            durationMs: durationMs(),
          })
        }
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
        if (active !== undefined) {
          await stopProcess(active, terminationOptions)
          if (activeExecutions.get(input.executionId) === active) {
            activeExecutions.delete(input.executionId)
          }
        }
        await stderrDrain?.catch(() => undefined)
        if (schemaDirectory !== undefined) {
          await rm(schemaDirectory, { recursive: true, force: true }).catch(() => undefined)
        }
      }
    },

    async cancel(executionId): Promise<AgentCancelResult> {
      const active = activeExecutions.get(executionId)
      if (active === undefined) return { status: 'unconfirmed' }
      active.cancelRequested = true
      active.resolveCancelled()
      return (await stopProcess(active, terminationOptions))
        ? { status: 'cancelled' }
        : { status: 'unconfirmed' }
    },
  }
}

const processEnv = (): Readonly<NodeJS.ProcessEnv> => ({ ...process.env })
