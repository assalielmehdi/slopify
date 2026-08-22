import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AgentExecutionEventSchema,
  AgentExecutionInputSchema,
  type AgentNodeResult,
} from '../src/contract.js'
import { createPiSdkAgentExecutor } from '../src/pi-sdk-executor.js'
import type { LoadedResourceBundle } from '../src/resource-loader.js'
import type { PiSession, PiSessionFactory } from '../src/session-factory.js'

const input = AgentExecutionInputSchema.parse({
  executionId: 'execution-01',
  runId: 'run-01',
  nodeId: 'plan',
  workspace: {
    rootPath: '/workspaces/run-01',
    repositories: [
      {
        repositoryId: 'backend',
        path: '/workspaces/run-01/backend',
        access: 'read-only',
      },
    ],
  },
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  thinkingLevel: 'high',
  permissionProfile: 'read-only',
  renderedPrompt: '# Plan\n\nInspect the explicit workspace.',
  declaredOutcomes: ['planned', 'blocked'],
  resourceBundleId: 'delivery.planning.v1',
  timeoutSeconds: 1,
})

const result: AgentNodeResult = {
  outcome: 'planned',
  summary: 'Prepared a bounded plan.',
  data: { sections: 3 },
  artifacts: [],
  evidence: [],
}

const resourceBundle: LoadedResourceBundle = {
  bundleId: 'delivery.planning.v1',
  applicationVersion: '1.0.0',
  skills: [],
  promptFragments: [],
  contextFiles: [],
}

const pending = new Promise<void>(() => undefined)

const createSession = (overrides: Partial<PiSession> = {}) => {
  let idle = true
  let listener: ((event: unknown) => void) | undefined
  const unsubscribe = vi.fn()
  const session: PiSession = {
    sessionId: 'session-01',
    prompt: vi.fn(async () => undefined),
    subscribe: vi.fn((nextListener) => {
      listener = nextListener
      return unsubscribe
    }),
    abort: vi.fn(async () => {
      idle = true
    }),
    waitForIdle: vi.fn(async () => undefined),
    isIdle: vi.fn(() => idle),
    finish: vi.fn(() => result),
    getUsage: vi.fn(() => ({
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    })),
    dispose: vi.fn(),
    ...overrides,
  }
  return {
    session,
    unsubscribe,
    setIdle(value: boolean) {
      idle = value
    },
    emit(event: unknown) {
      listener?.(event)
    },
  }
}

const createExecutor = (
  session: PiSession,
  now = () => Date.parse('2026-08-19T00:00:00Z'),
  sensitiveValues: readonly string[] = [],
) => {
  const sessionFactory: PiSessionFactory = {
    create: vi.fn(async () => session),
  }
  return {
    executor: createPiSdkAgentExecutor({
      sessionFactory,
      resolveContext: async () => ({
        outputSchema: z.object({ sections: z.number().int().positive() }),
        resourceBundle,
      }),
      sensitiveValues,
      now,
    }),
    sessionFactory,
  }
}

const collect = async <T>(iterable: AsyncIterable<T>): Promise<T[]> => {
  const values: T[] = []
  for await (const value of iterable) values.push(value)
  return values
}

describe('Pi SDK executor', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits one successful lifecycle and releases the fresh subscription and session', async () => {
    const { session, unsubscribe } = createSession()
    const { executor, sessionFactory } = createExecutor(session)

    const events = await collect(executor.execute(input))

    expect(events.map(({ type }) => type)).toEqual([
      'AGENT_STARTED',
      'AGENT_SESSION_IDENTIFIED',
      'AGENT_RESULT',
    ])
    expect(events.every((event) => AgentExecutionEventSchema.safeParse(event).success)).toBe(true)
    expect(events[2]).toMatchObject({
      type: 'AGENT_RESULT',
      data: {
        result,
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          cacheReadTokens: 3,
          cacheWriteTokens: 2,
        },
        durationMs: 0,
      },
    })
    expect(sessionFactory.create).toHaveBeenCalledWith({
      input,
      outputSchema: expect.anything(),
      resourceBundle,
    })
    expect(session.subscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(session.dispose).toHaveBeenCalledTimes(1)
  })

  it('passes a sandbox to Pi and destroys it before cancellation is confirmed', async () => {
    const created = createSession({ prompt: vi.fn(() => pending) })
    const cleanup = vi.fn(async () => undefined)
    const sandbox = {
      workspaceRoot: '/workspace',
      tools: [],
      skills: [],
    }
    const sessionFactory: PiSessionFactory = { create: vi.fn(async () => created.session) }
    const executor = createPiSdkAgentExecutor({
      sessionFactory,
      resolveContext: async () => ({
        outputSchema: z.object({ sections: z.number().int().positive() }),
        resourceBundle,
        sandbox,
        cleanup,
      }),
      sensitiveValues: [],
    })
    const iterator = executor.execute(input)[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()

    await expect(executor.cancel(input.executionId)).resolves.toEqual({ status: 'cancelled' })
    expect(sessionFactory.create).toHaveBeenCalledWith({
      input,
      outputSchema: expect.anything(),
      resourceBundle,
      sandbox,
    })
    expect(cleanup).toHaveBeenCalledOnce()
    await iterator.next()
    await iterator.next()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('emits normalized subscribed events before one redacted result', async () => {
    const secret = 'sk-provider-secret'
    const created = createSession({
      finish: vi.fn(() => ({
        ...result,
        summary: `Prepared with ${secret}`,
        data: { sections: 3, credential: secret },
      })),
    })
    vi.mocked(created.session.prompt).mockImplementation(async () => {
      created.emit({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: `Visible ${secret}` },
      })
      created.emit({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: `Hidden ${secret}` },
      })
      created.emit({
        type: 'tool_execution_start',
        toolCallId: 'tool-01',
        toolName: 'read',
        args: { credential: secret },
      })
      created.emit({
        type: 'tool_execution_update',
        toolCallId: 'tool-01',
        toolName: 'read',
        partialResult: { content: [{ type: 'text', text: `token=${secret}` }] },
      })
      created.emit({
        type: 'tool_execution_end',
        toolCallId: 'tool-01',
        toolName: 'read',
        result: { content: [{ type: 'text', text: `done ${secret}` }] },
        isError: false,
      })
    })
    const { executor } = createExecutor(created.session, () => Date.parse('2026-08-19T00:00:00Z'), [
      secret,
    ])

    const events = await collect(executor.execute(input))

    expect(events.map(({ type }) => type)).toEqual([
      'AGENT_STARTED',
      'AGENT_SESSION_IDENTIFIED',
      'AGENT_MESSAGE',
      'AGENT_REASONING',
      'AGENT_TOOL_STARTED',
      'AGENT_TOOL_UPDATED',
      'AGENT_TOOL_COMPLETED',
      'AGENT_RESULT',
    ])
    expect(JSON.stringify(events)).not.toContain(secret)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'AGENT_REASONING',
        data: { content: 'Hidden [REDACTED]' },
      }),
    )
    expect(events.at(-1)).toMatchObject({
      type: 'AGENT_RESULT',
      data: {
        result: {
          summary: 'Prepared with [REDACTED]',
          data: { sections: 3, credential: '[REDACTED]' },
        },
      },
    })
  })

  it('cancels through abort, idle confirmation, subscription release, and disposal', async () => {
    const { session, unsubscribe } = createSession({ prompt: vi.fn(() => pending) })
    const { executor } = createExecutor(session)
    const iterator = executor.execute(input)[Symbol.asyncIterator]()

    expect((await iterator.next()).value?.type).toBe('AGENT_STARTED')
    expect((await iterator.next()).value?.type).toBe('AGENT_SESSION_IDENTIFIED')
    const terminal = iterator.next()
    await expect(executor.cancel(input.executionId)).resolves.toEqual({ status: 'cancelled' })

    await expect(terminal).resolves.toMatchObject({
      value: { type: 'AGENT_CANCELLED' },
      done: false,
    })
    expect(session.abort).toHaveBeenCalledTimes(1)
    expect(session.waitForIdle).toHaveBeenCalledTimes(1)
    expect(session.isIdle).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(session.dispose).toHaveBeenCalledTimes(1)
    await iterator.next()
  })

  it('retains tool-finalization evidence emitted while the SDK aborts', async () => {
    const created = createSession({ prompt: vi.fn(() => pending) })
    vi.mocked(created.session.abort).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      created.emit({
        type: 'tool_execution_end',
        toolCallId: 'tool-01',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'Command aborted' }] },
        isError: true,
      })
    })
    const { executor } = createExecutor(created.session)
    const iterator = executor.execute(input)[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    const observation = iterator.next()

    await expect(executor.cancel(input.executionId)).resolves.toEqual({ status: 'cancelled' })
    await expect(observation).resolves.toMatchObject({
      value: {
        type: 'AGENT_TOOL_COMPLETED',
        data: { toolCallId: 'tool-01', status: 'failed', content: 'Command aborted' },
      },
    })
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'AGENT_CANCELLED' },
    })
    await iterator.next()
  })

  it('fails cancellation when SDK idleness cannot be confirmed', async () => {
    const { session } = createSession({
      prompt: vi.fn(() => pending),
      isIdle: vi.fn(() => false),
    })
    const { executor } = createExecutor(session)
    const iterator = executor.execute(input)[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    const terminal = iterator.next()

    await expect(executor.cancel(input.executionId)).resolves.toEqual({ status: 'unconfirmed' })
    await expect(terminal).resolves.toMatchObject({
      value: {
        type: 'AGENT_FAILED',
        data: { code: 'AGENT_STOP_UNCONFIRMED' },
      },
    })
    expect(session.dispose).toHaveBeenCalledTimes(1)
    await iterator.next()
  })

  it('applies the node timeout through the same confirmed stop path', async () => {
    vi.useFakeTimers()
    const { session, unsubscribe } = createSession({ prompt: vi.fn(() => pending) })
    const { executor } = createExecutor(session)
    const iterator = executor.execute(input)[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.next()
    const terminal = iterator.next()

    await vi.advanceTimersByTimeAsync(1_000)

    await expect(terminal).resolves.toMatchObject({
      value: {
        type: 'AGENT_FAILED',
        data: { code: 'AGENT_TIMEOUT', message: 'Agent execution timed out' },
      },
    })
    expect(session.abort).toHaveBeenCalledTimes(1)
    expect(session.waitForIdle).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(session.dispose).toHaveBeenCalledTimes(1)
    await iterator.next()
  })

  it('does not expose provider failure details', async () => {
    const credential = 'provider-credential-that-must-not-escape'
    const { session } = createSession({
      prompt: vi.fn(async () => {
        throw new Error(credential)
      }),
    })
    const { executor } = createExecutor(session)

    const events = await collect(executor.execute(input))
    const serialized = JSON.stringify(events)

    expect(events.at(-1)).toMatchObject({
      type: 'AGENT_FAILED',
      data: { code: 'AGENT_SESSION_FAILED', message: 'Agent session failed' },
    })
    expect(serialized).not.toContain(credential)
    expect(session.dispose).toHaveBeenCalledTimes(1)
  })
})
