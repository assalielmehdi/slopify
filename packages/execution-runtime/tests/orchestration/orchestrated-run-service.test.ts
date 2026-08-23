import { describe, expect, it } from 'vitest'

import {
  createOrchestratedRunService,
  createRunService,
  createSqliteCoordinatorStateStore,
  createSqliteExecutionMessageQueue,
  createWorkflowCoordinator,
} from '../../src/index.js'
import {
  TEST_WORKFLOW_ID,
  createPersistenceFixture,
  createTestAgentWorkflow,
  createTestHarnessCatalog,
  resolveTestProject,
} from '../persistence/test-fixture.js'

describe('orchestrated run service', () => {
  it('starts the durable coordinator before returning the admitted run', async () => {
    const fixture = createPersistenceFixture(
      createTestAgentWorkflow({
        createdAt: '2026-08-20T12:00:00.000Z',
        projectIds: ['project-api'],
        primaryProjectId: 'project-api',
      }),
    )
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
        runs: fixture.runs,
        workflows: fixture.workflows,
        harnesses: createTestHarnessCatalog(),
        resolveProject: resolveTestProject,
        createRunId: () => 'run-orchestrated',
        now: () => '2026-08-20T12:00:00.000Z',
      })
      const service = createOrchestratedRunService({ runs: base, coordinator })

      const run = await service.create({ workflowId: TEST_WORKFLOW_ID })

      expect(run).toMatchObject({ runId: 'run-orchestrated', status: 'RUNNING' })
      expect(queue.list({ destination: 'WORKER' })).toEqual([
        expect.objectContaining({
          type: 'EXECUTE_NODE',
          runId: 'run-orchestrated',
          payload: { version: 1, nodeId: fixture.workflow.startNodeId },
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
