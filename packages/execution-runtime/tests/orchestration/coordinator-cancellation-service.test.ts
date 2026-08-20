import { describe, expect, it, vi } from 'vitest'

import {
  createCoordinatorCancellationService,
  createSqliteCoordinatorStateStore,
  createSqliteExecutionMessageQueue,
  createWorkflowCoordinator,
} from '../../src/index.js'
import { TEST_RUN_ID, createPersistenceFixture, createRun } from '../persistence/test-fixture.js'

describe('coordinator cancellation service', () => {
  it('cancels queued attempts and persists the terminal run state', async () => {
    const fixture = createPersistenceFixture()
    try {
      createRun(fixture, fixture.revision)
      const queue = createSqliteExecutionMessageQueue(fixture.database)
      const coordinator = createWorkflowCoordinator({
        coordinatorId: 'coordinator-01',
        queue,
        state: createSqliteCoordinatorStateStore(fixture.database),
        now: () => '2026-08-20T12:00:00.000Z',
      })
      coordinator.start({ runId: TEST_RUN_ID, workflow: fixture.revision })
      const cancelRun = vi.fn(async () => ({ status: 'unconfirmed' as const }))
      const service = createCoordinatorCancellationService({
        runs: fixture.runs,
        coordinator,
        worker: { activeRunIds: () => [], cancelRun },
      })

      await expect(
        service.cancel({ runId: TEST_RUN_ID, reason: 'Stopped' }),
      ).resolves.toMatchObject({ status: 'CANCELLED' })
      expect(cancelRun).not.toHaveBeenCalled()
      expect(queue.list({ destination: 'WORKER', status: 'PENDING' })).toHaveLength(0)
      expect(fixture.events.list({ runId: TEST_RUN_ID, limit: 100 }).events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'RUN_CANCEL_REQUESTED',
            data: expect.objectContaining({ reason: 'Stopped' }),
          }),
          expect.objectContaining({
            type: 'RUN_COMPLETED',
            data: expect.objectContaining({ status: 'CANCELLED' }),
          }),
        ]),
      )
    } finally {
      fixture.cleanup()
    }
  })
})
