import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CancellationServiceError,
  createCancellationService,
  type ActiveRunExecution,
} from '../../src/index.js'
import { TEST_RUN_ID, createPersistenceFixture, createRun } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const startRun = (fixture: ReturnType<typeof createPersistenceFixture>): void => {
  createRun(fixture)
  fixture.runs.changeStatus({
    runId: TEST_RUN_ID,
    expectedStatus: 'PENDING',
    status: 'RUNNING',
    timestamp: '2026-08-18T20:00:01Z',
  })
  fixture.runs.startNode({
    runId: TEST_RUN_ID,
    nodeExecutionId: 'node-execution-cancel-1',
    nodeId: 'load-clickup-task',
    inputReferences: [],
    timestamp: '2026-08-18T20:00:02Z',
  })
}

const activeExecution = (cancel: ActiveRunExecution['cancel']): ActiveRunExecution => ({
  runId: TEST_RUN_ID,
  nodeExecutionId: 'node-execution-cancel-1',
  nodeId: 'load-clickup-task',
  cancel,
})

describe('run cancellation', () => {
  it('marks the active run cancelled only after its executor confirms termination', async () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    startRun(fixture)
    const cancel = vi.fn(async () => ({ status: 'cancelled' as const }))
    const service = createCancellationService({
      runs: fixture.runs,
      activeExecution: () => activeExecution(cancel),
      now: () => '2026-08-18T20:00:05Z',
    })

    const run = await service.cancel({ runId: TEST_RUN_ID, reason: 'Operator requested stop' })

    expect(cancel).toHaveBeenCalledWith({ reason: 'Operator requested stop' })
    expect(run.status).toBe('CANCELLED')
    expect(fixture.runs.listNodeExecutions(TEST_RUN_ID)).toEqual([
      expect.objectContaining({
        status: 'CANCELLED',
        errorCode: 'EXECUTOR_CANCELLED',
      }),
    ])
    expect(
      fixture.events.list({ runId: TEST_RUN_ID, limit: 20 }).events.map(({ type }) => type),
    ).toEqual([
      'RUN_STARTED',
      'RUN_STATUS_CHANGED',
      'NODE_STARTED',
      'RUN_CANCEL_REQUESTED',
      'NODE_FAILED',
      'RUN_STATUS_CHANGED',
      'RUN_COMPLETED',
    ])
  })

  it('fails explicitly when the active executor cannot confirm termination', async () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    startRun(fixture)
    const service = createCancellationService({
      runs: fixture.runs,
      activeExecution: () => activeExecution(async () => ({ status: 'unconfirmed' as const })),
      now: () => '2026-08-18T20:00:05Z',
    })

    const run = await service.cancel({ runId: TEST_RUN_ID })

    expect(run.status).toBe('FAILED')
    expect(fixture.runs.listNodeExecutions(TEST_RUN_ID)).toEqual([
      expect.objectContaining({
        status: 'FAILED',
        errorCode: 'CANCELLATION_UNCONFIRMED',
        errorMessage: 'Active execution could not confirm cancellation',
      }),
    ])
    expect(fixture.events.list({ runId: TEST_RUN_ID, limit: 20 }).events.at(-1)).toMatchObject({
      type: 'RUN_COMPLETED',
      data: { status: 'FAILED' },
    })
  })

  it('does not cancel a pending run or call a non-matching active execution', async () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)
    const cancel = vi.fn(async () => ({ status: 'cancelled' as const }))
    const service = createCancellationService({
      runs: fixture.runs,
      activeExecution: () => activeExecution(cancel),
    })

    await expect(service.cancel({ runId: TEST_RUN_ID })).rejects.toMatchObject({
      code: 'RUN_NOT_CANCELLABLE',
    } satisfies Partial<CancellationServiceError>)
    expect(cancel).not.toHaveBeenCalled()
    expect(fixture.runs.get(TEST_RUN_ID)?.status).toBe('PENDING')
    expect(fixture.events.list({ runId: TEST_RUN_ID, limit: 20 }).events).toHaveLength(1)
  })
})
