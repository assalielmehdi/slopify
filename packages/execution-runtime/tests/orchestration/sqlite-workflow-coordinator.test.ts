import { describe, expect, it } from 'vitest'

import {
  createSqliteCoordinatorStateStore,
  createSqliteExecutionMessageQueue,
  createWorkflowCoordinator,
} from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'
import {
  TEST_RUN_ID,
  createPersistenceFixture,
  createRun,
  createTestAgentWorkflow,
} from '../persistence/test-fixture.js'

const timestamp = '2026-08-20T10:00:00.000Z'
const workflow = createTestAgentWorkflow({ createdAt: timestamp })

describe('SQLite workflow coordinator', () => {
  it('commits coordinator state, run history, and successor commands atomically', () => {
    const fixture = createPersistenceFixture(workflow)
    try {
      createRun(fixture, workflow)
      const connection = getDatabaseHandle(fixture.database)
      const queue = createSqliteExecutionMessageQueue(fixture.database)
      const state = createSqliteCoordinatorStateStore(fixture.database)
      let id = 0
      const coordinator = createWorkflowCoordinator({
        coordinatorId: 'coordinator-01',
        queue,
        state,
        now: () => timestamp,
        createId: (prefix) => `${prefix}-${++id}`,
      })

      coordinator.start({ runId: TEST_RUN_ID, workflow })
      const execution = state.get(TEST_RUN_ID)?.executions[0]
      if (execution === undefined) throw new Error('execution missing')
      queue.enqueue({
        id: 'success-01',
        destination: 'COORDINATOR',
        type: 'NODE_EXECUTION_SUCCEEDED',
        runId: TEST_RUN_ID,
        nodeExecutionId: execution.nodeExecutionId,
        attemptId: execution.attemptId,
        payload: {
          version: 1,
          outcome: 'completed',
          output: { summary: 'Done' },
          completedAt: timestamp,
          durationMs: 1,
        },
        availableAt: timestamp,
        createdAt: timestamp,
      })

      expect(coordinator.runOnce()).toBe(true)
      expect(queue.get('success-01')).toMatchObject({ status: 'PROCESSED' })
      expect(state.get(TEST_RUN_ID)).toMatchObject({ status: 'SUCCEEDED', transitionCount: 0 })
      expect(
        connection.prepare('SELECT status FROM runs WHERE run_id = ?').pluck().get(TEST_RUN_ID),
      ).toBe('SUCCEEDED')
      expect(
        connection
          .prepare('SELECT status FROM node_executions WHERE node_execution_id = ?')
          .pluck()
          .get(execution.nodeExecutionId),
      ).toBe('SUCCEEDED')
      expect(
        connection
          .prepare('SELECT COUNT(*) FROM run_events WHERE run_id = ?')
          .pluck()
          .get(TEST_RUN_ID),
      ).toBeGreaterThan(2)
    } finally {
      fixture.cleanup()
    }
  })
})
