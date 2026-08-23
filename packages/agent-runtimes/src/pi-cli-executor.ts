import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

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
import { createPiEventNormalizer, type PiEventNormalizer } from './event-normalizer.js'
import { createEventRedactor, redactAgentNodeResult } from './redaction.js'

const MAX_JSONL_RECORD_BYTES = 4 * 1024 * 1024
const MAX_COMPLETION_RESULT_BYTES = 262_144
const MAX_SENSITIVE_ENVIRONMENT_VALUES = 256
const MAX_SENSITIVE_ENVIRONMENT_VALUE_LENGTH = 16_384
const COMPLETION_PROTOCOL = 'slopify.node-result'
const SECRET_LIKE_ENVIRONMENT_KEY = /(?:token|key|secret|password|credential|auth)/iu

export interface PiCliSpawnInput {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<NodeJS.ProcessEnv>
}

export interface PiCliProcessExit {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

export interface PiCliProcess {
  readonly stdout: AsyncIterable<string | Uint8Array>
  readonly stderr: AsyncIterable<string | Uint8Array>
  readonly exited: Promise<PiCliProcessExit>
  write(line: string): void
  end(): void
  kill(signal: NodeJS.Signals): boolean
}

export interface PiCliProcessSpawner {
  spawn(input: PiCliSpawnInput): PiCliProcess
}

export interface CreatePiCliAgentExecutorOptions {
  readonly executablePath?: string
  readonly completionExtensionPath?: string
  readonly processSpawner?: PiCliProcessSpawner
  readonly env?: Readonly<NodeJS.ProcessEnv>
  readonly now?: () => number
  readonly terminationGraceMs?: number
  readonly forceKillGraceMs?: number
}

interface ActiveExecution {
  readonly process: PiCliProcess
  readonly cancelled: Promise<void>
  readonly resolveCancelled: () => void
  cancelRequested: boolean
  stopPromise: Promise<boolean> | undefined
}

interface RpcResponse {
  readonly id: string
  readonly type: 'response'
  readonly command: string
  readonly success: boolean
  readonly data?: unknown
}

class PiExecutionError extends Error {
  override readonly name = 'PiExecutionError'

  constructor(
    readonly code:
      | 'AGENT_SESSION_FAILED'
      | 'AGENT_TIMEOUT'
      | 'COMPLETION_INPUT_INVALID'
      | 'COMPLETION_MISSING'
      | 'COMPLETION_OUTCOME_UNDECLARED'
      | 'COMPLETION_REPEATED'
      | 'COMPLETION_RESULT_TOO_LARGE'
      | 'HARNESS_PROCESS_EXITED'
      | 'HARNESS_PROTOCOL_FAILED',
    message: string,
  ) {
    super(message)
  }
}

const failureMessages = {
  AGENT_SESSION_FAILED: 'Pi agent session failed',
  AGENT_STOP_UNCONFIRMED: 'Pi process termination could not be confirmed',
  AGENT_TIMEOUT: 'Agent execution timed out',
  COMPLETION_INPUT_INVALID: 'Pi returned an invalid node result',
  COMPLETION_MISSING: 'Pi finished without a node result',
  COMPLETION_OUTCOME_UNDECLARED: 'Pi returned an undeclared node outcome',
  COMPLETION_REPEATED: 'Pi returned more than one node result',
  COMPLETION_RESULT_TOO_LARGE: 'Pi returned a node result that is too large',
  HARNESS_PROCESS_EXITED: 'Pi exited before completing the node',
  HARNESS_PROTOCOL_FAILED: 'Pi RPC protocol failed',
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const sensitiveEnvironmentValues = (environment: Readonly<NodeJS.ProcessEnv>): readonly string[] =>
  [
    ...new Set(
      Object.entries(environment)
        .filter(
          ([key, value]) =>
            SECRET_LIKE_ENVIRONMENT_KEY.test(key) &&
            typeof value === 'string' &&
            value.length > 0 &&
            value.length <= MAX_SENSITIVE_ENVIRONMENT_VALUE_LENGTH,
        )
        .map(([, value]) => value as string),
    ),
  ].slice(0, MAX_SENSITIVE_ENVIRONMENT_VALUES)

const delay = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

const waitForExit = async (process: PiCliProcess, milliseconds: number): Promise<boolean> => {
  try {
    return await Promise.race([
      process.exited.then(() => true),
      delay(milliseconds).then(() => false),
    ])
  } catch {
    return true
  }
}

export const createNodePiCliProcessSpawner = (): PiCliProcessSpawner => ({
  spawn(input) {
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: { ...input.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const exited = new Promise<PiCliProcessExit>((resolve) => {
      child.once('error', () => resolve({ exitCode: null, signal: null }))
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
    })
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      exited,
      write(line) {
        if (!child.stdin.write(line)) {
          // Node continues buffering and preserves write order until the stream drains.
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

export async function* decodePiJsonLines(
  source: AsyncIterable<string | Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const chunk of source) {
    buffered += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    let delimiterIndex = buffered.indexOf('\n')
    while (delimiterIndex >= 0) {
      let record = buffered.slice(0, delimiterIndex)
      buffered = buffered.slice(delimiterIndex + 1)
      if (record.endsWith('\r')) record = record.slice(0, -1)
      if (Buffer.byteLength(record, 'utf8') > MAX_JSONL_RECORD_BYTES) {
        throw new Error('Pi RPC JSONL record is too large')
      }
      if (record.length > 0) yield JSON.parse(record) as unknown
      delimiterIndex = buffered.indexOf('\n')
    }
    if (Buffer.byteLength(buffered, 'utf8') > MAX_JSONL_RECORD_BYTES) {
      throw new Error('Pi RPC JSONL record is too large')
    }
  }
  buffered += decoder.decode()
  if (buffered.length > 0) throw new Error('Pi RPC ended with an unterminated JSONL record')
}

const drain = async (source: AsyncIterable<string | Uint8Array>): Promise<void> => {
  for await (const chunk of source) {
    void chunk
    // Draining stderr prevents the child process from blocking on a full pipe. Error text stays private.
  }
}

const completionExtensionPath = (): string => {
  const compiled = fileURLToPath(new URL('./slopify-completion-extension.js', import.meta.url))
  if (existsSync(compiled)) return compiled
  return fileURLToPath(new URL('./slopify-completion-extension.ts', import.meta.url))
}

const createActiveExecution = (process: PiCliProcess): ActiveExecution => {
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
  abort: boolean,
): Promise<boolean> => {
  if (active.stopPromise !== undefined) return active.stopPromise
  active.stopPromise = (async () => {
    if (abort) {
      try {
        active.process.write(`${JSON.stringify({ type: 'abort' })}\n`)
      } catch {
        // Continue with bounded OS-level termination.
      }
      if (await waitForExit(active.process, options.terminationGraceMs)) return true
    }
    try {
      active.process.end()
    } catch {
      // Continue with signals when stdin cannot be closed.
    }
    if (await waitForExit(active.process, options.terminationGraceMs)) return true
    try {
      active.process.kill('SIGTERM')
    } catch {
      // Continue to the final bounded SIGKILL attempt.
    }
    if (await waitForExit(active.process, options.forceKillGraceMs)) return true
    try {
      active.process.kill('SIGKILL')
    } catch {
      return false
    }
    return waitForExit(active.process, options.forceKillGraceMs)
  })()
  return active.stopPromise
}

const rpcResponse = (value: unknown): RpcResponse | undefined => {
  if (
    !isRecord(value) ||
    value.type !== 'response' ||
    typeof value.id !== 'string' ||
    typeof value.command !== 'string' ||
    typeof value.success !== 'boolean'
  ) {
    return undefined
  }
  return {
    id: value.id,
    type: 'response',
    command: value.command,
    success: value.success,
    ...(value.data === undefined ? {} : { data: value.data }),
  }
}

const nextRecord = async (iterator: AsyncIterator<unknown>): Promise<Record<string, unknown>> => {
  let next: IteratorResult<unknown>
  try {
    next = await iterator.next()
  } catch {
    throw new PiExecutionError('HARNESS_PROTOCOL_FAILED', failureMessages.HARNESS_PROTOCOL_FAILED)
  }
  if (next.done) {
    throw new PiExecutionError('HARNESS_PROCESS_EXITED', failureMessages.HARNESS_PROCESS_EXITED)
  }
  if (!isRecord(next.value) || typeof next.value.type !== 'string') {
    throw new PiExecutionError('HARNESS_PROTOCOL_FAILED', failureMessages.HARNESS_PROTOCOL_FAILED)
  }
  return next.value
}

const request = async (
  process: PiCliProcess,
  iterator: AsyncIterator<unknown>,
  id: string,
  command: Readonly<Record<string, unknown>>,
  termination: Promise<'cancelled' | 'timeout'>,
): Promise<{
  readonly response: RpcResponse
  readonly events: readonly Record<string, unknown>[]
}> => {
  process.write(`${JSON.stringify({ id, ...command })}\n`)
  const events: Record<string, unknown>[] = []
  for (;;) {
    const next = await Promise.race([
      nextRecord(iterator).then((record) => ({ kind: 'record' as const, record })),
      termination.then((kind) => ({ kind })),
    ])
    if (next.kind !== 'record') {
      if (next.kind === 'timeout') {
        throw new PiExecutionError('AGENT_TIMEOUT', failureMessages.AGENT_TIMEOUT)
      }
      throw new PiExecutionError('AGENT_SESSION_FAILED', failureMessages.AGENT_SESSION_FAILED)
    }
    const { record } = next
    const response = rpcResponse(record)
    if (response === undefined) {
      events.push(record)
      continue
    }
    if (response.id !== id) {
      throw new PiExecutionError('HARNESS_PROTOCOL_FAILED', failureMessages.HARNESS_PROTOCOL_FAILED)
    }
    if (response.command !== command.type || !response.success) {
      throw new PiExecutionError('HARNESS_PROTOCOL_FAILED', failureMessages.HARNESS_PROTOCOL_FAILED)
    }
    return { response, events }
  }
}

const sessionId = (response: RpcResponse): string => {
  if (!isRecord(response.data) || typeof response.data.sessionId !== 'string') {
    throw new PiExecutionError('HARNESS_PROTOCOL_FAILED', failureMessages.HARNESS_PROTOCOL_FAILED)
  }
  return response.data.sessionId
}

const usage = (response: RpcResponse) => {
  const empty = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  if (!isRecord(response.data) || !isRecord(response.data.tokens)) return empty
  const tokens = response.data.tokens
  const value = (key: string): number => {
    const candidate = tokens[key]
    return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0
      ? candidate
      : 0
  }
  return {
    inputTokens: value('input'),
    outputTokens: value('output'),
    cacheReadTokens: value('cacheRead'),
    cacheWriteTokens: value('cacheWrite'),
  }
}

const completionCandidate = (event: Record<string, unknown>): unknown | undefined => {
  if (
    event.type !== 'tool_execution_end' ||
    event.toolName !== 'slopify_complete_node' ||
    event.isError === true ||
    !isRecord(event.result) ||
    !isRecord(event.result.details) ||
    event.result.details.protocol !== COMPLETION_PROTOCOL
  ) {
    return undefined
  }
  return event.result.details.result
}

const parseCompletion = (
  candidates: readonly unknown[],
  input: AgentExecutionInput,
): AgentNodeResult => {
  if (candidates.length === 0) {
    throw new PiExecutionError('COMPLETION_MISSING', failureMessages.COMPLETION_MISSING)
  }
  if (candidates.length !== 1) {
    throw new PiExecutionError('COMPLETION_REPEATED', failureMessages.COMPLETION_REPEATED)
  }
  const parsed = AgentNodeResultSchema.safeParse(candidates[0])
  if (!parsed.success) {
    throw new PiExecutionError('COMPLETION_INPUT_INVALID', failureMessages.COMPLETION_INPUT_INVALID)
  }
  if (!input.declaredOutcomes.includes(parsed.data.outcome)) {
    throw new PiExecutionError(
      'COMPLETION_OUTCOME_UNDECLARED',
      failureMessages.COMPLETION_OUTCOME_UNDECLARED,
    )
  }
  const serialized = JSON.stringify(parsed.data)
  if (new TextEncoder().encode(serialized).byteLength > MAX_COMPLETION_RESULT_BYTES) {
    throw new PiExecutionError(
      'COMPLETION_RESULT_TOO_LARGE',
      failureMessages.COMPLETION_RESULT_TOO_LARGE,
    )
  }
  return parsed.data
}

const prompt = (input: AgentExecutionInput): string => {
  const projects = input.workspace.projects.map(({ projectId, path }) => ({
    projectId,
    path,
    primary: projectId === input.workspace.primaryProjectId,
  }))
  return `${input.renderedPrompt}\n\n<slopify_execution_protocol>\nRun projects: ${JSON.stringify(projects)}\nComplete all work inside these project worktrees. Call slopify_complete_node exactly once with one of these declared outcomes: ${input.declaredOutcomes.join(', ')}. Do not finish without calling it.\n</slopify_execution_protocol>`
}

export const createPiCliAgentExecutor = (
  options: CreatePiCliAgentExecutorOptions = {},
): AgentExecutor => {
  const executablePath = options.executablePath ?? 'pi'
  const extensionPath = options.completionExtensionPath ?? completionExtensionPath()
  if (!isAbsolute(extensionPath)) {
    throw new Error('Pi completion extension path must be absolute')
  }
  const processSpawner = options.processSpawner ?? createNodePiCliProcessSpawner()
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
      let normalizer: PiEventNormalizer | undefined
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      let stderrDrain: Promise<void> | undefined

      yield createEvent(input, 'AGENT_STARTED', {})

      try {
        if (activeExecutions.has(input.executionId)) {
          throw new PiExecutionError('AGENT_SESSION_FAILED', failureMessages.AGENT_SESSION_FAILED)
        }
        const primary = input.workspace.projects.find(
          ({ projectId }) => projectId === input.workspace.primaryProjectId,
        )
        if (primary === undefined) {
          throw new PiExecutionError('AGENT_SESSION_FAILED', failureMessages.AGENT_SESSION_FAILED)
        }
        const environment = options.env ?? processEnv()
        const redactor = createEventRedactor({
          sensitiveValues: sensitiveEnvironmentValues(environment),
        })
        const args = [
          '--mode',
          'rpc',
          '--no-session',
          '--no-approve',
          '--extension',
          extensionPath,
          ...(input.model === undefined ? [] : ['--model', input.model]),
          ...(input.thinkingLevel === undefined ? [] : ['--thinking', input.thinkingLevel]),
        ]
        const process = processSpawner.spawn({
          executable: executablePath,
          args,
          cwd: primary.path,
          env: environment,
        })
        active = createActiveExecution(process)
        activeExecutions.set(input.executionId, active)
        stderrDrain = drain(process.stderr).catch(() => undefined)
        const records = decodePiJsonLines(process.stdout)[Symbol.asyncIterator]()
        normalizer = createPiEventNormalizer({
          redactor,
        })
        let requestNumber = 0
        const requestId = (): string => `${input.executionId}-${++requestNumber}`
        const timeout = new Promise<'timeout'>((resolve) => {
          timeoutId = setTimeout(() => resolve('timeout'), input.timeoutSeconds * 1_000)
        })
        const termination = Promise.race([
          active.cancelled.then(() => 'cancelled' as const),
          timeout,
        ])

        const state = await request(
          process,
          records,
          requestId(),
          { type: 'get_state' },
          termination,
        )
        for (const observation of state.events) {
          for (const normalized of normalizer.normalize(observation)) {
            yield createEvent(input, normalized.type, normalized.data)
          }
        }
        yield createEvent(input, 'AGENT_SESSION_IDENTIFIED', {
          sessionId: sessionId(state.response),
        })

        const accepted = await request(
          process,
          records,
          requestId(),
          {
            type: 'prompt',
            message: prompt(input),
          },
          termination,
        )
        for (const observation of accepted.events) {
          for (const normalized of normalizer.normalize(observation)) {
            yield createEvent(input, normalized.type, normalized.data)
          }
        }

        const candidates: unknown[] = []
        let settled = false
        while (!settled) {
          const next = await Promise.race([
            nextRecord(records).then((record) => ({ kind: 'record' as const, record })),
            active.cancelled.then(() => ({ kind: 'cancelled' as const })),
            timeout.then(() => ({ kind: 'timeout' as const })),
          ])
          if (next.kind === 'cancelled') {
            const confirmed = await stopProcess(active, terminationOptions, true)
            yield confirmed
              ? createEvent(input, 'AGENT_CANCELLED', {
                  reason: 'Cancellation requested',
                  durationMs: durationMs(),
                })
              : createEvent(input, 'AGENT_FAILED', {
                  code: 'AGENT_STOP_UNCONFIRMED',
                  message: failureMessages.AGENT_STOP_UNCONFIRMED,
                  durationMs: durationMs(),
                })
            return
          }
          if (next.kind === 'timeout') {
            const confirmed = await stopProcess(active, terminationOptions, true)
            yield createEvent(input, 'AGENT_FAILED', {
              code: confirmed ? 'AGENT_TIMEOUT' : 'AGENT_STOP_UNCONFIRMED',
              message: confirmed
                ? failureMessages.AGENT_TIMEOUT
                : failureMessages.AGENT_STOP_UNCONFIRMED,
              durationMs: durationMs(),
            })
            return
          }

          const response = rpcResponse(next.record)
          if (response !== undefined) {
            throw new PiExecutionError(
              'HARNESS_PROTOCOL_FAILED',
              failureMessages.HARNESS_PROTOCOL_FAILED,
            )
          }
          const candidate = completionCandidate(next.record)
          if (candidate !== undefined) candidates.push(candidate)
          for (const normalized of normalizer.normalize(next.record)) {
            yield createEvent(input, normalized.type, normalized.data)
          }
          settled = next.record.type === 'agent_settled'
        }

        const result = redactAgentNodeResult(parseCompletion(candidates, input), redactor)
        const stats = await request(
          process,
          records,
          requestId(),
          { type: 'get_session_stats' },
          termination,
        )
        for (const observation of stats.events) {
          for (const normalized of normalizer.normalize(observation)) {
            yield createEvent(input, normalized.type, normalized.data)
          }
        }
        const stopped = await stopProcess(active, terminationOptions, false)
        if (!stopped) {
          yield createEvent(input, 'AGENT_FAILED', {
            code: 'AGENT_STOP_UNCONFIRMED',
            message: failureMessages.AGENT_STOP_UNCONFIRMED,
            durationMs: durationMs(),
          })
          return
        }
        yield createEvent(input, 'AGENT_RESULT', {
          result,
          usage: usage(stats.response),
          durationMs: durationMs(),
        })
      } catch (error) {
        if (active?.cancelRequested === true) {
          const confirmed = await stopProcess(active, terminationOptions, true)
          yield confirmed
            ? createEvent(input, 'AGENT_CANCELLED', {
                reason: 'Cancellation requested',
                durationMs: durationMs(),
              })
            : createEvent(input, 'AGENT_FAILED', {
                code: 'AGENT_STOP_UNCONFIRMED',
                message: failureMessages.AGENT_STOP_UNCONFIRMED,
                durationMs: durationMs(),
              })
        } else if (error instanceof PiExecutionError && error.code === 'AGENT_TIMEOUT') {
          const confirmed =
            active === undefined || (await stopProcess(active, terminationOptions, true))
          yield createEvent(input, 'AGENT_FAILED', {
            code: confirmed ? 'AGENT_TIMEOUT' : 'AGENT_STOP_UNCONFIRMED',
            message: confirmed
              ? failureMessages.AGENT_TIMEOUT
              : failureMessages.AGENT_STOP_UNCONFIRMED,
            durationMs: durationMs(),
          })
        } else {
          const failure =
            error instanceof PiExecutionError
              ? error
              : new PiExecutionError('AGENT_SESSION_FAILED', failureMessages.AGENT_SESSION_FAILED)
          yield createEvent(input, 'AGENT_FAILED', {
            code: failure.code,
            message: failure.message,
            durationMs: durationMs(),
          })
        }
      } finally {
        normalizer?.finish()
        if (timeoutId !== undefined) clearTimeout(timeoutId)
        if (active !== undefined) {
          await stopProcess(active, terminationOptions, active.cancelRequested)
          if (activeExecutions.get(input.executionId) === active) {
            activeExecutions.delete(input.executionId)
          }
        }
        await stderrDrain?.catch(() => undefined)
      }
    },

    async cancel(executionId): Promise<AgentCancelResult> {
      const active = activeExecutions.get(executionId)
      if (active === undefined) return { status: 'unconfirmed' }
      active.cancelRequested = true
      active.resolveCancelled()
      return (await stopProcess(active, terminationOptions, true))
        ? { status: 'cancelled' }
        : { status: 'unconfirmed' }
    },
  }
}

const processEnv = (): Readonly<NodeJS.ProcessEnv> => ({ ...process.env })
