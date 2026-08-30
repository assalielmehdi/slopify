import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AgentExecutionEventSchema,
  AgentExecutionInputSchema,
} from '../../../../src/modules/harness/adapters/contract.js'
import {
  createPiCliAgentExecutor,
  decodePiJsonLines,
  type PiCliProcess,
  type PiCliProcessSpawner,
  type PiCliSpawnInput,
} from '../../../../src/modules/harness/adapters/pi-cli-executor.js'

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
  model: 'anthropic/claude-sonnet-4-5',
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

const jsonLine = (value: unknown): string => `${JSON.stringify(value)}\n`

class FakeProcess implements PiCliProcess {
  readonly stdout = new AsyncQueue<string>()
  readonly stderr = new AsyncQueue<string>()
  readonly writes: unknown[] = []
  readonly kill = vi.fn<(signal: NodeJS.Signals) => boolean>(() => true)
  readonly end = vi.fn(() => {
    this.stdout.end()
    this.stderr.end()
    this.#resolveExit({ exitCode: 0, signal: null })
  })
  readonly exited: Promise<{
    readonly exitCode: number | null
    readonly signal: NodeJS.Signals | null
  }>
  #resolveExit: (exit: {
    readonly exitCode: number | null
    readonly signal: NodeJS.Signals | null
  }) => void = () => undefined

  constructor(
    private readonly onCommand: (command: Record<string, unknown>, process: FakeProcess) => void,
  ) {
    this.exited = new Promise((resolve) => {
      this.#resolveExit = resolve
    })
  }

  write(line: string): void {
    const command = JSON.parse(line) as Record<string, unknown>
    this.writes.push(command)
    this.onCommand(command, this)
  }

  emit(value: unknown): void {
    this.stdout.push(jsonLine(value))
  }
}

const successfulProcess = (
  extraEvents: readonly unknown[] = [],
  completionResult: unknown = result,
): FakeProcess =>
  new FakeProcess((command, process) => {
    if (command.type === 'get_state') {
      process.emit({
        id: command.id,
        type: 'response',
        command: 'get_state',
        success: true,
        data: {
          sessionId: 'session-01',
          sessionFile: '/Users/developer/.pi/agent/sessions/project with space/session-01.jsonl',
          isStreaming: false,
        },
      })
    }
    if (command.type === 'prompt') {
      process.emit({
        id: command.id,
        type: 'response',
        command: 'prompt',
        success: true,
      })
      process.emit({ type: 'agent_start' })
      process.emit({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Working.' },
      })
      for (const event of extraEvents) process.emit(event)
      process.emit({
        type: 'tool_execution_start',
        toolCallId: 'complete-01',
        toolName: 'slopify_complete_node',
        args: completionResult,
      })
      process.emit({
        type: 'tool_execution_end',
        toolCallId: 'complete-01',
        toolName: 'slopify_complete_node',
        result: {
          content: [{ type: 'text', text: 'Node result accepted' }],
          details: { protocol: 'slopify.node-result', result: completionResult },
        },
        isError: false,
      })
      process.emit({ type: 'agent_settled' })
    }
    if (command.type === 'get_session_stats') {
      process.emit({
        id: command.id,
        type: 'response',
        command: 'get_session_stats',
        success: true,
        data: {
          tokens: { input: 11, output: 7, cacheRead: 3, cacheWrite: 2, total: 23 },
        },
      })
    }
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
  let spawnInput: PiCliSpawnInput | undefined
  const spawner: PiCliProcessSpawner = {
    spawn(input) {
      spawnInput = input
      return process
    },
  }
  return {
    executor: createPiCliAgentExecutor({
      executablePath: '/opt/homebrew/bin/pi',
      completionExtensionPath: '/Users/developer/slopify/slopify-completion-extension.js',
      processSpawner: spawner,
      terminationGraceMs: 0,
      forceKillGraceMs: 0,
      ...overrides,
    }),
    getSpawnInput: () => spawnInput,
  }
}

describe('Pi CLI executor', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores repository-local configuration while preserving host discovery and completion', async () => {
    const process = successfulProcess([{ type: 'future_event', value: 1 }])
    const { executor, getSpawnInput } = createExecutor(process, {
      now: () => Date.parse('2026-08-23T00:00:00Z'),
    })

    const events = await collect(executor.execute(input))

    expect(getSpawnInput()).toMatchObject({
      executable: '/opt/homebrew/bin/pi',
      args: [
        '--mode',
        'rpc',
        '--no-approve',
        '--extension',
        '/Users/developer/slopify/slopify-completion-extension.js',
        '--model',
        'anthropic/claude-sonnet-4-5',
        '--thinking',
        'high',
      ],
      cwd: '/workspaces/run-01/backend',
    })
    expect(getSpawnInput()?.args).not.toContain('--approve')
    expect(getSpawnInput()?.args).not.toContain('--no-session')
    expect(getSpawnInput()?.env.HOME).toBe(globalThis.process.env.HOME)
    expect(process.writes.map((command) => (command as { type: string }).type)).toEqual([
      'get_state',
      'prompt',
      'get_session_stats',
    ])
    expect(process.writes[0]).toMatchObject({ id: expect.any(String), type: 'get_state' })
    expect(process.writes[1]).toMatchObject({
      id: expect.any(String),
      type: 'prompt',
      message: expect.stringContaining('# Plan'),
    })
    expect(process.writes[1]).toMatchObject({
      message: expect.stringContaining('"repositoryId":"backend"'),
    })
    expect(process.writes[1]).toMatchObject({
      message: expect.stringContaining('Run artifacts: /runs/run-01/artifacts'),
    })
    expect(process.writes[1]).toMatchObject({
      message: expect.stringContaining('Omit evidence entries whose value would be empty'),
    })
    expect(process.writes[1]).toMatchObject({
      message: expect.stringContaining('planned, blocked'),
    })
    expect(events.every((event) => AgentExecutionEventSchema.safeParse(event).success)).toBe(true)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'AGENT_SESSION_IDENTIFIED',
        data: {
          sessionId: 'session-01',
          openCommand:
            "pi --session '/Users/developer/.pi/agent/sessions/project with space/session-01.jsonl'",
        },
      }),
    )
    expect(events.map(({ type }) => type)).toEqual([
      'AGENT_STARTED',
      'AGENT_SESSION_IDENTIFIED',
      'AGENT_RESULT',
    ])
    expect(events.at(-1)).toMatchObject({
      type: 'AGENT_RESULT',
      data: {
        result,
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          cacheReadTokens: 3,
          cacheWriteTokens: 2,
        },
      },
    })
    expect(process.end).toHaveBeenCalledOnce()
  })

  it('omits optional model and thinking flags', async () => {
    const process = successfulProcess()
    const { executor, getSpawnInput } = createExecutor(process)
    const { model: _model, thinkingLevel: _thinkingLevel, ...withoutPreferences } = input
    void _model
    void _thinkingLevel

    await collect(executor.execute(withoutPreferences))

    expect(getSpawnInput()?.args).toEqual([
      '--mode',
      'rpc',
      '--no-approve',
      '--extension',
      '/Users/developer/slopify/slopify-completion-extension.js',
    ])
  })

  it('redacts inherited secret-like environment values from events and the node result', async () => {
    const secret = 'bare-inherited-secret-value'
    const visible = 'visible-host-setting'
    const environment = {
      PATH: '/opt/homebrew/bin:/usr/bin',
      SERVICE_AUTH_TOKEN: secret,
      EMPTY_SECRET: '',
      VISIBLE_SETTING: visible,
    }
    const process = successfulProcess([{ type: 'future_event', secret, visible }], {
      ...result,
      summary: `Completed with ${secret}`,
      data: { secret, visible },
    })
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
    ['missing', [], 'COMPLETION_MISSING'],
    ['undeclared', [{ ...result, outcome: 'unknown' }], 'COMPLETION_OUTCOME_UNDECLARED'],
    ['repeated', [result, result], 'COMPLETION_REPEATED'],
    [
      'oversized',
      [
        {
          ...result,
          data: { content: 'x'.repeat(270_000) },
        },
      ],
      'COMPLETION_RESULT_TOO_LARGE',
    ],
  ])('fails a %s completion result', async (_case, completionResults, expectedCode) => {
    const process = new FakeProcess((command, current) => {
      if (command.type === 'get_state') {
        current.emit({
          id: command.id,
          type: 'response',
          command: 'get_state',
          success: true,
          data: {
            sessionId: 'session-01',
            sessionFile: '/Users/developer/.pi/agent/sessions/session-01.jsonl',
          },
        })
      }
      if (command.type === 'prompt') {
        current.emit({
          id: command.id,
          type: 'response',
          command: 'prompt',
          success: true,
        })
        for (const completionResult of completionResults) {
          current.emit({
            type: 'tool_execution_end',
            toolCallId: crypto.randomUUID(),
            toolName: 'slopify_complete_node',
            result: {
              content: [{ type: 'text', text: 'Node result accepted' }],
              details: { protocol: 'slopify.node-result', result: completionResult },
            },
            isError: false,
          })
        }
        current.emit({ type: 'agent_settled' })
      }
    })
    const { executor } = createExecutor(process)

    const events = await collect(executor.execute(input))

    expect(events.at(-1)).toMatchObject({
      type: 'AGENT_FAILED',
      data: { code: expectedCode },
    })
  })

  it('cancels through RPC abort and bounded process termination', async () => {
    const process = new FakeProcess((command, current) => {
      if (command.type === 'get_state') {
        current.emit({
          id: command.id,
          type: 'response',
          command: 'get_state',
          success: true,
          data: {
            sessionId: 'session-01',
            sessionFile: '/Users/developer/.pi/agent/sessions/session-01.jsonl',
          },
        })
      }
      if (command.type === 'prompt') {
        current.emit({
          id: command.id,
          type: 'response',
          command: 'prompt',
          success: true,
        })
      }
    })
    const { executor } = createExecutor(process)
    const iterator = executor.execute(input)[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    const terminal = iterator.next()

    await expect(executor.cancel(input.executionId)).resolves.toEqual({ status: 'cancelled' })
    await expect(terminal).resolves.toMatchObject({
      value: { type: 'AGENT_CANCELLED' },
      done: false,
    })
    expect(process.writes).toContainEqual(expect.objectContaining({ type: 'abort' }))
    await iterator.next()
  })

  it('applies the execution timeout through the same bounded termination path', async () => {
    vi.useFakeTimers()
    const process = new FakeProcess((command, current) => {
      if (command.type === 'get_state') {
        current.emit({
          id: command.id,
          type: 'response',
          command: 'get_state',
          success: true,
          data: {
            sessionId: 'session-01',
            sessionFile: '/Users/developer/.pi/agent/sessions/session-01.jsonl',
          },
        })
      }
      if (command.type === 'prompt') {
        current.emit({
          id: command.id,
          type: 'response',
          command: 'prompt',
          success: true,
        })
      }
    })
    const { executor } = createExecutor(process)
    const iterator = executor.execute({ ...input, timeoutSeconds: 1 })[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    const terminal = iterator.next()

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.runAllTimersAsync()

    await expect(terminal).resolves.toMatchObject({
      value: {
        type: 'AGENT_FAILED',
        data: { code: 'AGENT_TIMEOUT', message: 'Agent execution timed out' },
      },
      done: false,
    })
    expect(process.writes).toContainEqual(expect.objectContaining({ type: 'abort' }))
    await iterator.next()
  })

  it('applies the timeout while waiting for Pi startup state', async () => {
    vi.useFakeTimers()
    const process = new FakeProcess(() => undefined)
    const { executor } = createExecutor(process)
    const iterator = executor.execute({ ...input, timeoutSeconds: 1 })[Symbol.asyncIterator]()
    await iterator.next()
    const terminal = iterator.next()

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.runAllTimersAsync()

    await expect(terminal).resolves.toMatchObject({
      value: {
        type: 'AGENT_FAILED',
        data: { code: 'AGENT_TIMEOUT', message: 'Agent execution timed out' },
      },
      done: false,
    })
    expect(process.writes).toEqual([
      expect.objectContaining({ type: 'get_state' }),
      expect.objectContaining({ type: 'abort' }),
    ])
    await iterator.next()
  })

  it('fails safely when stdout violates the JSONL protocol', async () => {
    const process = new FakeProcess(() => undefined)
    process.stdout.push('{not-json}\n')
    const { executor } = createExecutor(process)

    const events = await collect(executor.execute(input))

    expect(events.at(-1)).toMatchObject({
      type: 'AGENT_FAILED',
      data: { code: 'HARNESS_PROTOCOL_FAILED', message: 'Pi RPC protocol failed' },
    })
  })
})

describe('Pi JSONL framing', () => {
  it('uses LF framing, accepts CRLF, and preserves Unicode separators inside JSON strings', async () => {
    const chunks = new AsyncQueue<string>()
    chunks.push('{"type":"one","value":"a')
    chunks.push(' b"}\r\n{"type":"two"}\n')
    chunks.end()

    await expect(collect(decodePiJsonLines(chunks))).resolves.toEqual([
      { type: 'one', value: 'a b' },
      { type: 'two' },
    ])
  })

  it('rejects an unterminated final record', async () => {
    const chunks = new AsyncQueue<string>()
    chunks.push('{"type":"one"}')
    chunks.end()

    await expect(collect(decodePiJsonLines(chunks))).rejects.toThrow('unterminated JSONL record')
  })
})
