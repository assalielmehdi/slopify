import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  AgentExecutionEventSchema,
  AgentExecutionInputSchema,
} from '../../../../src/modules/harness/adapters/contract.js'
import {
  createCodexCliAgentExecutor,
  type CodexCliProcess,
  type CodexCliProcessSpawner,
  type CodexCliSpawnInput,
} from '../../../../src/modules/harness/adapters/codex-cli-executor.js'

class AsyncQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = []
  readonly #waiters: ((value: IteratorResult<T>) => void)[] = []
  #ended = false

  push(value: T): void {
    const waiter = this.#waiters.shift()
    if (waiter === undefined) this.#values.push(value)
    else waiter({ value, done: false })
  }

  end(): void {
    this.#ended = true
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.#values.shift()
        if (value !== undefined) return { value, done: false }
        if (this.#ended) return { value: undefined, done: true }
        return new Promise((resolve) => this.#waiters.push(resolve))
      },
    }
  }
}

const input = AgentExecutionInputSchema.parse({
  executionId: 'execution-01',
  runId: 'run-01',
  nodeId: 'plan',
  artifactsPath: '/runs/run-01/artifacts',
  workspace: {
    rootPath: '/workspaces/run-01',
    primaryRepositoryId: 'backend',
    repositories: [
      { repositoryId: 'backend', path: '/workspaces/run-01/backend' },
      { repositoryId: 'web', path: '/workspaces/run-01/web' },
    ],
  },
  model: 'gpt-5.6-sol',
  thinkingLevel: 'high',
  renderedPrompt: '# Plan\n\nInspect the explicit workspace.',
  declaredOutcomes: ['planned', 'blocked'],
  timeoutSeconds: 60,
})

const result = {
  outcome: 'planned',
  summary: 'Prepared a bounded plan.',
  data: { sections: 3 },
  evidence: [],
}

const noCompletion = Symbol('no-completion')

const jsonLine = (value: unknown): string => `${JSON.stringify(value)}\n`

const wireCompletion = (completion: unknown): string => {
  if (completion === null || typeof completion !== 'object' || Array.isArray(completion)) {
    return typeof completion === 'string' ? completion : JSON.stringify(completion)
  }
  return JSON.stringify({
    ...completion,
    data: JSON.stringify((completion as { readonly data?: unknown }).data),
  })
}

class FakeProcess implements CodexCliProcess {
  readonly stdout = new AsyncQueue<string>()
  readonly stderr = new AsyncQueue<string>()
  readonly writes: string[] = []
  readonly kill = vi.fn<(signal: NodeJS.Signals) => boolean>(() => {
    this.finish({ exitCode: null, signal: 'SIGTERM' })
    return true
  })
  readonly end = vi.fn(() => this.onEnd(this))
  readonly exited: Promise<{
    readonly exitCode: number | null
    readonly signal: NodeJS.Signals | null
  }>
  #resolveExit: (exit: {
    readonly exitCode: number | null
    readonly signal: NodeJS.Signals | null
  }) => void = () => undefined

  constructor(private readonly onEnd: (process: FakeProcess) => void) {
    this.exited = new Promise((resolve) => {
      this.#resolveExit = resolve
    })
  }

  write(content: string): void {
    this.writes.push(content)
  }

  emit(value: unknown): void {
    this.stdout.push(jsonLine(value))
  }

  finish(exit = { exitCode: 0, signal: null as NodeJS.Signals | null }): void {
    this.stdout.end()
    this.stderr.end()
    this.#resolveExit(exit)
  }
}

const successfulProcess = (
  completionResult: unknown | typeof noCompletion = result,
  extraEvents: readonly unknown[] = [],
): FakeProcess =>
  new FakeProcess((process) => {
    process.emit({ type: 'thread.started', thread_id: 'thread-01' })
    process.emit({ type: 'turn.started' })
    process.emit({
      type: 'item.started',
      item: {
        id: 'command-01',
        type: 'command_execution',
        command: 'bun test',
        status: 'in_progress',
      },
    })
    process.emit({
      type: 'item.completed',
      item: {
        id: 'command-01',
        type: 'command_execution',
        command: 'bun test',
        aggregated_output: '3 tests passed',
        status: 'completed',
      },
    })
    process.emit({
      type: 'item.completed',
      item: { id: 'reasoning-01', type: 'reasoning', text: 'Checking the contract.' },
    })
    for (const event of extraEvents) process.emit(event)
    if (completionResult !== noCompletion) {
      process.emit({
        type: 'item.completed',
        item: {
          id: 'message-01',
          type: 'agent_message',
          text: wireCompletion(completionResult),
        },
      })
    }
    process.emit({
      type: 'turn.completed',
      usage: {
        input_tokens: 11,
        cached_input_tokens: 3,
        output_tokens: 7,
        reasoning_output_tokens: 2,
      },
    })
    process.finish()
  })

const collect = async <T>(iterable: AsyncIterable<T>): Promise<T[]> => {
  const values: T[] = []
  for await (const value of iterable) values.push(value)
  return values
}

const createExecutor = (
  process: FakeProcess,
  overrides: { now?: () => number; env?: Readonly<NodeJS.ProcessEnv> } = {},
) => {
  let spawnInput: CodexCliSpawnInput | undefined
  let completionSchema: unknown
  const spawner: CodexCliProcessSpawner = {
    spawn(nextInput) {
      spawnInput = nextInput
      const schemaIndex = nextInput.args.indexOf('--output-schema')
      const schemaPath = nextInput.args[schemaIndex + 1]
      if (schemaPath !== undefined && existsSync(schemaPath)) {
        completionSchema = JSON.parse(readFileSync(schemaPath, 'utf8')) as unknown
      }
      return process
    },
  }
  return {
    executor: createCodexCliAgentExecutor({
      executablePath: '/opt/homebrew/bin/codex',
      processSpawner: spawner,
      terminationGraceMs: 0,
      forceKillGraceMs: 0,
      ...overrides,
    }),
    getSpawnInput: () => spawnInput,
    getCompletionSchema: () => completionSchema,
  }
}

describe('Codex CLI executor', () => {
  it('runs an ephemeral JSONL session in YOLO mode with structured completion', async () => {
    const process = successfulProcess(result, [{ type: 'future.event', value: 1 }])
    const { executor, getSpawnInput, getCompletionSchema } = createExecutor(process, {
      now: () => Date.parse('2026-08-26T12:00:00Z'),
    })

    const events = await collect(executor.execute(input))
    const spawnInput = getSpawnInput()

    expect(spawnInput).toMatchObject({
      executable: '/opt/homebrew/bin/codex',
      cwd: '/workspaces/run-01/backend',
    })
    expect(spawnInput?.args).toEqual([
      'exec',
      '--ephemeral',
      '--json',
      '--color',
      'never',
      '--yolo',
      '--output-schema',
      expect.stringMatching(/slopify-codex-.+\/node-result\.schema\.json$/u),
      '--model',
      'gpt-5.6-sol',
      '-c',
      'model_reasoning_effort="high"',
      '-',
    ])
    expect(spawnInput?.args).not.toContain('--sandbox')
    expect(spawnInput?.args).not.toContain('--add-dir')
    expect(spawnInput?.args).not.toContain('--skip-git-repo-check')
    expect(getCompletionSchema()).toMatchObject({
      type: 'object',
      properties: {
        outcome: { enum: ['planned', 'blocked'] },
        data: { type: 'string' },
      },
      required: ['outcome', 'summary', 'data', 'evidence'],
      additionalProperties: false,
    })
    expect(process.writes).toHaveLength(1)
    expect(process.writes[0]).toContain('# Plan')
    expect(process.writes[0]).toContain('"repositoryId":"backend"')
    expect(process.writes[0]).toContain('Run artifacts: /runs/run-01/artifacts')
    expect(process.writes[0]).toContain('Omit evidence entries whose value would be empty')
    expect(process.writes[0]).toContain('final response must match the provided JSON Schema')
    expect(process.end).toHaveBeenCalledOnce()
    expect(events.every((event) => AgentExecutionEventSchema.safeParse(event).success)).toBe(true)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'AGENT_SESSION_IDENTIFIED',
        data: { sessionId: 'thread-01' },
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'HARNESS_EVENT',
        data: { harnessId: 'codex', event: { type: 'future.event', value: 1 } },
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'AGENT_TOOL_COMPLETED',
        data: expect.objectContaining({
          toolCallId: 'command-01',
          toolName: 'command_execution',
          status: 'succeeded',
          content: '3 tests passed',
        }),
      }),
    )
    expect(events.at(-1)).toMatchObject({
      type: 'AGENT_RESULT',
      data: {
        result,
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          cacheReadTokens: 3,
          cacheWriteTokens: 0,
        },
      },
    })
  })

  it('omits optional model and thinking flags', async () => {
    const process = successfulProcess()
    const { executor, getSpawnInput } = createExecutor(process)
    const { model: _model, thinkingLevel: _thinkingLevel, ...withoutPreferences } = input
    void _model
    void _thinkingLevel

    await collect(executor.execute(withoutPreferences))

    expect(getSpawnInput()?.args).not.toContain('--model')
    expect(getSpawnInput()?.args).not.toContain('-c')
  })

  it('redacts inherited secret-like environment values from events and the node result', async () => {
    const secret = 'bare-inherited-secret-value'
    const visible = 'visible-host-setting'
    const environment = {
      PATH: '/opt/homebrew/bin:/usr/bin',
      SERVICE_AUTH_TOKEN: secret,
      VISIBLE_SETTING: visible,
    }
    const process = successfulProcess(
      {
        ...result,
        summary: `Completed with ${secret}`,
        data: { secret, visible },
      },
      [{ type: 'future.event', secret, visible }],
    )
    const { executor, getSpawnInput } = createExecutor(process, { env: environment })

    const events = await collect(executor.execute(input))
    const serializedEvents = JSON.stringify(events)

    expect(getSpawnInput()?.env).toEqual(environment)
    expect(serializedEvents).not.toContain(secret)
    expect(serializedEvents).toContain('[REDACTED]')
    expect(serializedEvents).toContain(visible)
    expect(events.at(-1)).toMatchObject({
      type: 'AGENT_RESULT',
      data: {
        result: {
          summary: 'Completed with [REDACTED]',
          data: { secret: '[REDACTED]', visible },
        },
      },
    })
  })

  it.each([
    ['missing', noCompletion, 'COMPLETION_MISSING'],
    ['invalid', 'not JSON', 'COMPLETION_INPUT_INVALID'],
    [
      'invalid data',
      JSON.stringify({ ...result, data: 'not encoded JSON' }),
      'COMPLETION_INPUT_INVALID',
    ],
    ['undeclared', { ...result, outcome: 'unknown' }, 'COMPLETION_OUTCOME_UNDECLARED'],
    [
      'oversized',
      { ...result, data: { content: 'x'.repeat(270_000) } },
      'COMPLETION_RESULT_TOO_LARGE',
    ],
  ])('fails a %s completion result', async (_case, completionResult, expectedCode) => {
    const process = successfulProcess(completionResult)
    const { executor } = createExecutor(process)

    const events = await collect(executor.execute(input))

    expect(events.at(-1)).toMatchObject({
      type: 'AGENT_FAILED',
      data: { code: expectedCode },
    })
  })

  it('fails safely when Codex reports a failed turn', async () => {
    const process = new FakeProcess((current) => {
      current.emit({ type: 'thread.started', thread_id: 'thread-01' })
      current.emit({ type: 'turn.failed', error: { message: 'private provider error' } })
      current.finish({ exitCode: 1, signal: null })
    })
    const { executor } = createExecutor(process)

    const events = await collect(executor.execute(input))

    expect(events.at(-1)).toMatchObject({
      type: 'AGENT_FAILED',
      data: { code: 'AGENT_SESSION_FAILED', message: 'Codex agent session failed' },
    })
  })

  it('fails safely when stdout violates the JSONL protocol', async () => {
    const process = new FakeProcess((current) => {
      current.stdout.push('{not-json}\n')
      current.finish({ exitCode: 1, signal: null })
    })
    const { executor } = createExecutor(process)

    const events = await collect(executor.execute(input))

    expect(events.at(-1)).toMatchObject({
      type: 'AGENT_FAILED',
      data: { code: 'HARNESS_PROTOCOL_FAILED', message: 'Codex JSONL protocol failed' },
    })
  })

  it('cancels through bounded process termination', async () => {
    const process = new FakeProcess((current) => {
      current.emit({ type: 'thread.started', thread_id: 'thread-01' })
    })
    const { executor } = createExecutor(process)
    const iterator = executor.execute(input)[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    await iterator.next()
    const terminal = iterator.next()

    await expect(executor.cancel(input.executionId)).resolves.toEqual({ status: 'cancelled' })
    await expect(terminal).resolves.toMatchObject({
      value: { type: 'AGENT_CANCELLED' },
      done: false,
    })
    expect(process.kill).toHaveBeenCalledWith('SIGTERM')
    await iterator.next()
  })

  it('applies the execution timeout through bounded process termination', async () => {
    const process = new FakeProcess(() => undefined)
    const { executor } = createExecutor(process)
    const iterator = executor.execute({ ...input, timeoutSeconds: 1 })[Symbol.asyncIterator]()
    await iterator.next()
    const terminal = iterator.next()

    await expect(terminal).resolves.toMatchObject({
      value: {
        type: 'AGENT_FAILED',
        data: { code: 'AGENT_TIMEOUT', message: 'Agent execution timed out' },
      },
      done: false,
    })
    expect(process.kill).toHaveBeenCalledWith('SIGTERM')
    await iterator.next()
  })
})
