import { afterEach, describe, expect, it } from 'vitest'

import {
  createEventStore,
  createRecoveryService,
  createRunRepository,
  openDatabase,
} from '../../src/index.js'
import { TEST_RUN_ID, createPersistenceFixture, createRun } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

describe('restart reconciliation', () => {
  it('preserves prior history and interrupts a persisted running node without resuming it', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)
    fixture.runs.changeStatus({
      runId: TEST_RUN_ID,
      expectedStatus: 'PENDING',
      status: 'RUNNING',
      timestamp: '2026-08-18T20:00:01Z',
    })
    fixture.runs.startNode({
      runId: TEST_RUN_ID,
      nodeExecutionId: 'node-execution-restart-1',
      nodeId: 'load-clickup-task',
      inputReferences: [],
      timestamp: '2026-08-18T20:00:02Z',
    })
    fixture.runs.recordOutput({
      runId: TEST_RUN_ID,
      nodeExecutionId: 'node-execution-restart-1',
      nodeId: 'load-clickup-task',
      channel: 'stdout',
      content: 'partial output before restart',
      timestamp: '2026-08-18T20:00:03Z',
    })
    fixture.database.close()

    const restartedDatabase = openDatabase({ path: fixture.path })
    const runs = createRunRepository(restartedDatabase)
    const events = createEventStore(restartedDatabase)
    const recovery = createRecoveryService({
      runs,
      now: () => '2026-08-18T20:00:05Z',
    })

    const interrupted = recovery.reconcile()

    expect(interrupted).toMatchObject({ runId: TEST_RUN_ID, status: 'INTERRUPTED' })
    expect(runs.listNodeExecutions(TEST_RUN_ID)).toEqual([
      expect.objectContaining({
        status: 'FAILED',
        errorCode: 'PROCESS_INTERRUPTED',
        errorMessage: 'Execution was interrupted by process restart',
      }),
    ])
    expect(events.list({ runId: TEST_RUN_ID, limit: 20 }).events).toMatchObject([
      { type: 'RUN_STARTED', sequence: 1 },
      { type: 'RUN_STATUS_CHANGED', sequence: 2 },
      { type: 'NODE_STARTED', sequence: 3 },
      { type: 'NODE_OUTPUT', sequence: 4 },
      { type: 'NODE_FAILED', sequence: 5 },
      { type: 'RUN_STATUS_CHANGED', sequence: 6, data: { to: 'INTERRUPTED' } },
      { type: 'RUN_COMPLETED', sequence: 7, data: { status: 'INTERRUPTED' } },
    ])
    expect(recovery.reconcile()).toBeUndefined()
    expect(events.list({ runId: TEST_RUN_ID, limit: 20 }).events).toHaveLength(7)
    restartedDatabase.close()
  })

  it('leaves a pending run unchanged because no execution had started', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)
    const recovery = createRecoveryService({ runs: fixture.runs })

    expect(recovery.reconcile()).toBeUndefined()
    expect(fixture.runs.get(TEST_RUN_ID)?.status).toBe('PENDING')
    expect(fixture.events.list({ runId: TEST_RUN_ID, limit: 20 }).events).toHaveLength(1)
  })
})
