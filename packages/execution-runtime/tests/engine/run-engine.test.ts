import { afterEach, describe, expect, it, vi } from 'vitest'

import { createExecutorRegistry, createRunEngine, type NodeExecutor } from '../../src/index.js'
import { TEST_RUN_ID, createPersistenceFixture, createRun } from '../persistence/test-fixture.js'
import { createCyclicWorkflow, createSimpleWorkflow } from './test-workflows.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const succeeded = (outcome: string) => ({
  status: 'succeeded' as const,
  outcome,
  artifactIds: [],
  output: { outcome },
})

const createEngine = (
  fixture: ReturnType<typeof createPersistenceFixture>,
  commands: Readonly<Record<string, NodeExecutor>>,
  resolveTimeoutMs: () => number = () => 1_000,
) => {
  let executionIndex = 0
  return createRunEngine({
    runs: fixture.runs,
    workflows: fixture.workflows,
    executors: createExecutorRegistry({ commands }),
    now: () => Date.parse('2026-08-18T20:00:10Z'),
    createNodeExecutionId: () => `node-execution-${++executionIndex}`,
    resolveTimeoutMs,
  })
}

describe('sequential run engine', () => {
  it('persists a legal result and edge before completing at the target terminal', async () => {
    const fixture = createPersistenceFixture(createSimpleWorkflow())
    fixtures.push(fixture)
    createRun(fixture)
    const execute = vi.fn(async () => succeeded('done'))
    const engine = createEngine(fixture, { 'start-command': { execute } })

    const result = await engine.execute(TEST_RUN_ID)

    expect(result).toMatchObject({ status: 'completed', run: { status: 'SUCCEEDED' } })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(fixture.runs.get(TEST_RUN_ID)).toMatchObject({
      status: 'SUCCEEDED',
      currentNodeId: 'succeeded',
      transitionCount: 1,
    })
    expect(
      fixture.events.list({ runId: TEST_RUN_ID, limit: 20 }).events.map(({ type }) => type),
    ).toEqual([
      'RUN_STARTED',
      'RUN_STATUS_CHANGED',
      'NODE_STARTED',
      'NODE_COMPLETED',
      'EDGE_SELECTED',
      'RUN_STATUS_CHANGED',
      'RUN_COMPLETED',
    ])
  })

  it('treats an explicit blocked outcome as a completed route to the failed terminal', async () => {
    const fixture = createPersistenceFixture(createSimpleWorkflow())
    fixtures.push(fixture)
    createRun(fixture)
    const engine = createEngine(fixture, {
      'start-command': { execute: async () => succeeded('blocked') },
    })

    const result = await engine.execute(TEST_RUN_ID)

    expect(result).toMatchObject({ status: 'completed', run: { status: 'FAILED' } })
    expect(result).not.toHaveProperty('failure')
    expect(fixture.runs.get(TEST_RUN_ID)?.currentNodeId).toBe('failed')
  })

  it.each([
    {
      name: 'declared executor failure',
      executor: {
        execute: async () => ({
          status: 'failed',
          code: 'FAKE_FAILURE',
          message: 'Fake executor failed',
        }),
      },
      expectedCode: 'EXECUTOR_FAILED',
      persistedCode: 'FAKE_FAILURE',
    },
    {
      name: 'malformed executor result',
      executor: { execute: async () => ({ status: 'succeeded', outcome: 'done' }) },
      expectedCode: 'EXECUTOR_RESULT_INVALID',
      persistedCode: undefined,
    },
    {
      name: 'undeclared outcome',
      executor: { execute: async () => succeeded('invented') },
      expectedCode: 'OUTCOME_UNDECLARED',
      persistedCode: undefined,
    },
    {
      name: 'thrown executor error',
      executor: {
        execute: async () => {
          throw new Error('provider details stay internal')
        },
      },
      expectedCode: 'EXECUTOR_FAILED',
      persistedCode: undefined,
    },
  ])(
    'fails visibly for a $name without selecting an edge',
    async ({ executor, expectedCode, persistedCode }) => {
      const fixture = createPersistenceFixture(createSimpleWorkflow())
      fixtures.push(fixture)
      createRun(fixture)
      const engine = createEngine(fixture, { 'start-command': executor })

      const result = await engine.execute(TEST_RUN_ID)

      expect(result).toMatchObject({
        status: 'failed',
        failure: { code: expectedCode },
        run: { status: 'FAILED' },
      })
      const events = fixture.events.list({ runId: TEST_RUN_ID, limit: 20 }).events
      expect(events.some(({ type }) => type === 'NODE_FAILED')).toBe(true)
      expect(events.some(({ type }) => type === 'EDGE_SELECTED')).toBe(false)
      if (persistedCode !== undefined) {
        expect(events.find(({ type }) => type === 'NODE_FAILED')).toMatchObject({
          data: { code: persistedCode },
        })
      }
    },
  )

  it('times out and aborts an executor before failing the run', async () => {
    const fixture = createPersistenceFixture(createSimpleWorkflow())
    fixtures.push(fixture)
    createRun(fixture)
    const observedAbort = vi.fn()
    const engine = createEngine(
      fixture,
      {
        'start-command': {
          execute: async ({ signal }) =>
            new Promise((resolve) => {
              signal.addEventListener('abort', () => {
                observedAbort()
                resolve(succeeded('done'))
              })
            }),
        },
      },
      () => 5,
    )

    const result = await engine.execute(TEST_RUN_ID)

    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'EXECUTOR_TIMEOUT' },
      run: { status: 'FAILED' },
    })
    expect(observedAbort).toHaveBeenCalledOnce()
  })

  it('stops a cycle before selecting an edge beyond the transition limit', async () => {
    const fixture = createPersistenceFixture(createCyclicWorkflow())
    fixtures.push(fixture)
    createRun(fixture)
    const engine = createEngine(fixture, {
      'start-command': { execute: async () => succeeded('next') },
      'loop-command': { execute: async () => succeeded('retry') },
    })

    const result = await engine.execute(TEST_RUN_ID)

    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'TRANSITION_LIMIT_EXCEEDED' },
      run: { status: 'FAILED', transitionCount: 2 },
    })
    const events = fixture.events.list({ runId: TEST_RUN_ID, limit: 50 }).events
    expect(events.filter(({ type }) => type === 'EDGE_SELECTED')).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({
      type: 'RUN_COMPLETED',
      data: { status: 'FAILED' },
    })
  })

  it('rejects a workflow before execution when its command is not registered', async () => {
    const fixture = createPersistenceFixture(createSimpleWorkflow())
    fixtures.push(fixture)
    createRun(fixture)
    const engine = createEngine(fixture, {})

    const result = await engine.execute(TEST_RUN_ID)

    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'WORKFLOW_INVALID' },
      run: { status: 'FAILED' },
    })
  })
})
