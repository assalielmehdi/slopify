import { describe, expect, it } from 'vitest'

import {
  createOrchestratedRunService,
  createRunService,
  createSqliteCoordinatorStateStore,
  createSqliteExecutionMessageQueue,
  createWorkflowCoordinator,
  type ReadinessService,
} from '../../src/index.js'
import {
  TEST_PROFILE_ID,
  TEST_REVISION_ID,
  TEST_WORKFLOW_ID,
  createPersistenceFixture,
} from '../persistence/test-fixture.js'

describe('orchestrated run service', () => {
  it('starts the durable coordinator before returning the admitted run', async () => {
    const fixture = createPersistenceFixture()
    try {
      const queue = createSqliteExecutionMessageQueue(fixture.database)
      const coordinator = createWorkflowCoordinator({
        coordinatorId: 'coordinator-01',
        queue,
        state: createSqliteCoordinatorStateStore(fixture.database),
        now: () => '2026-08-20T12:00:00.000Z',
      })
      const base = createRunService({
        events: fixture.events,
        profiles: fixture.profiles,
        readiness: {
          check: async () => ({ ready: true, checks: [] }),
        } as unknown as ReadinessService,
        runs: fixture.runs,
        tasks: { resolve: async () => ({ taskId: 'TASK-1', title: 'Run me' }) },
        workflows: fixture.workflows,
        createRunId: () => 'run-orchestrated',
        createProfileSnapshotId: () => 'snapshot-orchestrated',
        now: () => '2026-08-20T12:00:00.000Z',
      })
      const service = createOrchestratedRunService({ runs: base, coordinator })

      const run = await service.create({
        taskReference: 'TASK-1',
        workflowId: TEST_WORKFLOW_ID,
        revisionId: TEST_REVISION_ID,
        profileId: TEST_PROFILE_ID,
      })

      expect(run).toMatchObject({ runId: 'run-orchestrated', status: 'RUNNING' })
      expect(queue.list({ destination: 'WORKER' })).toEqual([
        expect.objectContaining({
          type: 'EXECUTE_JOB',
          runId: 'run-orchestrated',
          payload: { version: 1, nodeId: fixture.revision.startNodeId, jobKind: 'command' },
        }),
      ])
      expect(service.get('run-orchestrated')?.events).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'RUN_STATUS_CHANGED' })]),
      )
    } finally {
      fixture.cleanup()
    }
  })
})
