import type { Workflow } from '@slopify/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  RunDomainEventSchema,
  createJournalCancellationService,
  createJournalExecutionWorker,
  createJournalWorkflowCoordinator,
  createRunProjectionState,
  reduceRunEvents,
  type NewRunDomainEvent,
  type RunDomainEvent,
  type RunJournal,
} from '../../src/index.js'

const timestamp = '2026-08-25T10:00:00.000Z'
const locator = { workflowId: 'cancel-review', runId: 'run-01' }
const workflow: Workflow = {
  schemaVersion: 3,
  workflowId: 'cancel-review',
  description: 'Exercise journal cancellation.',
  configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
  startNodeId: 'review',
  nodes: [
    {
      type: 'agent',
      id: 'review',
      name: 'Review',
      prompt: 'Review the change.',
      harness: { harnessId: 'pi' },
    },
  ],
  edges: [],
  maxTransitions: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
}

const createFixture = () => {
  const events: RunDomainEvent[] = []
  const initial = createRunProjectionState({
    run: {
      schemaVersion: 1,
      runId: 'run-01',
      workflowId: 'cancel-review',
      status: 'PENDING',
      transitionCount: 0,
      lastEventSequence: 0,
      createdAt: timestamp,
      startedAt: null,
      completedAt: null,
      failureCode: null,
    },
    workspaces: { schemaVersion: 1, runId: 'run-01', lastEventSequence: 0, workspaces: [] },
  })
  const journal: RunJournal = {
    async append(input: NewRunDomainEvent) {
      const existing = events.find(({ eventId }) => eventId === input.eventId)
      if (existing !== undefined) return existing
      const event = RunDomainEventSchema.parse({
        ...input,
        schemaVersion: 1,
        runId: 'run-01',
        sequence: events.length + 1,
      })
      events.push(event)
      return event
    },
    async replay() {
      return { status: 'READY', events: structuredClone(events), recoveredBytes: 0 }
    },
    async repairProjections() {
      return {
        status: 'READY',
        events: structuredClone(events),
        recoveredBytes: 0,
        projection: reduceRunEvents(initial, events),
        repaired: false,
      }
    },
  }
  const runs = {
    async load() {
      return { workflow, journal }
    },
  }
  const coordinator = createJournalWorkflowCoordinator({ runs, now: () => timestamp })
  return { coordinator, events, runs }
}

describe('journal cancellation service', () => {
  it('durably requests cancellation, confirms the active process, and is idempotent', async () => {
    const fixture = createFixture()
    await fixture.coordinator.start(locator)
    let finish: ((result: { status: 'cancelled'; reason: string }) => void) | undefined
    const cancel = vi.fn(async () => {
      finish?.({ status: 'cancelled', reason: 'Stopped by user' })
      return { status: 'cancelled' as const }
    })
    const worker = createJournalExecutionWorker({
      runs: fixture.runs,
      coordinator: fixture.coordinator,
      runner: {
        run: () =>
          new Promise((resolve) => {
            finish = resolve
          }),
        cancel,
      },
      now: () => timestamp,
    })
    const running = worker.runOnce([locator])
    await vi.waitFor(() => expect(worker.executingRunIds()).toEqual(['run-01']))
    const service = createJournalCancellationService({ coordinator: fixture.coordinator, worker })

    await expect(service.cancel({ ...locator, reason: 'Stopped by user' })).resolves.toMatchObject({
      run: { status: 'CANCELLED' },
    })
    await running
    await expect(service.cancel({ ...locator, reason: 'Duplicate' })).resolves.toMatchObject({
      run: { status: 'CANCELLED' },
    })

    expect(cancel).toHaveBeenCalledOnce()
    expect(fixture.events.filter(({ type }) => type === 'RUN_CANCEL_REQUESTED')).toHaveLength(1)
    expect(fixture.events.filter(({ type }) => type === 'NODE_CANCELLED')).toHaveLength(1)
    expect(fixture.events.filter(({ type }) => type === 'RUN_CANCELLED')).toHaveLength(1)
  })

  it('rejects unconfirmed cancellation after journaling the evidence', async () => {
    const fixture = createFixture()
    await fixture.coordinator.start(locator)
    let finish: ((result: { status: 'failed'; code: string; message: string }) => void) | undefined
    const worker = createJournalExecutionWorker({
      runs: fixture.runs,
      coordinator: fixture.coordinator,
      runner: {
        run: () =>
          new Promise((resolve) => {
            finish = resolve
          }),
        async cancel() {
          return { status: 'unconfirmed' }
        },
      },
      now: () => timestamp,
    })
    const running = worker.runOnce([locator])
    await vi.waitFor(() => expect(worker.executingRunIds()).toEqual(['run-01']))
    const service = createJournalCancellationService({ coordinator: fixture.coordinator, worker })

    await expect(service.cancel({ ...locator, reason: 'Stopped by user' })).rejects.toMatchObject({
      code: 'PROCESS_TERMINATION_UNCONFIRMED',
    })
    expect(fixture.events.at(-1)).toMatchObject({ type: 'NODE_TERMINATION_UNCONFIRMED' })
    finish?.({ status: 'failed', code: 'TEST_FINISHED', message: 'Test finished' })
    await running
  })
})
