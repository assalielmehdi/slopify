import type { Workflow } from '@slopify/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  RunDomainEventSchema,
  createJournalExecutionWorker,
  type JournalCoordinatorStore,
  type NewRunDomainEvent,
  type NodeRunner,
  type RunDomainEvent,
  type RunJournal,
} from '../../src/index.js'

const timestamp = '2026-08-25T10:00:00.000Z'
const workflow: Workflow = {
  schemaVersion: 3,
  workflowId: 'worker-review',
  description: 'Exercise the journal worker.',
  configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
  startNodeId: 'review',
  nodes: [
    {
      type: 'agent',
      id: 'review',
      name: 'Review',
      prompt: 'Review the change.',
      harness: { harnessId: 'pi' },
      timeoutSeconds: 900,
    },
  ],
  edges: [],
  maxTransitions: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
}

const createFixture = (executionCount = 1) => {
  const events: RunDomainEvent[] = []
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
      throw new Error('Projection repair is not used by the worker')
    },
  }
  for (let index = 0; index < executionCount; index += 1) {
    events.push(
      RunDomainEventSchema.parse({
        schemaVersion: 1,
        eventId: `schedule-${index}`,
        runId: 'run-01',
        sequence: index + 1,
        timestamp,
        type: 'NODE_SCHEDULED',
        data: {
          nodeExecutionId: `node-execution-${index}`,
          attemptId: `attempt-${index}`,
          nodeId: 'review',
          executionIndex: index,
          causationId: 'run-started',
        },
      }),
    )
  }
  const runs: JournalCoordinatorStore = {
    async load({ runId }) {
      return runId === 'run-01' ? { workflow, journal } : undefined
    },
  }
  return { events, journal, runs }
}

const locator = { workflowId: 'worker-review', runId: 'run-01' }

describe('journal execution worker', () => {
  it('durably starts an attempt before launching the graph-neutral runner', async () => {
    const fixture = createFixture()
    const reconcile = vi.fn(async () => undefined as never)
    const runner: NodeRunner = {
      run: vi.fn(async () => {
        expect(fixture.events.map(({ type }) => type)).toEqual(['NODE_SCHEDULED', 'NODE_STARTED'])
        return { status: 'succeeded', outcome: 'completed', output: { summary: 'Done' } }
      }),
      cancel: vi.fn(async () => ({ status: 'cancelled' })),
    }
    const worker = createJournalExecutionWorker({
      runs: fixture.runs,
      coordinator: { reconcile },
      runner,
      now: () => timestamp,
    })

    await expect(worker.runOnce([locator])).resolves.toBe(true)
    expect(runner.run).toHaveBeenCalledWith({
      runId: 'run-01',
      nodeExecutionId: 'node-execution-0',
      attemptId: 'attempt-0',
      nodeId: 'review',
    })
    expect(fixture.events.map(({ type }) => type)).toEqual([
      'NODE_SCHEDULED',
      'NODE_STARTED',
      'NODE_SUCCEEDED',
    ])
    expect(reconcile).toHaveBeenCalledWith(locator)
  })

  it('bounds concurrency while draining durable schedules', async () => {
    const fixture = createFixture(5)
    let active = 0
    let maximum = 0
    const runner: NodeRunner = {
      async run() {
        active += 1
        maximum = Math.max(maximum, active)
        await Promise.resolve()
        active -= 1
        return { status: 'succeeded', outcome: 'completed', output: {} }
      },
      async cancel() {
        return { status: 'cancelled' }
      },
    }
    const worker = createJournalExecutionWorker({
      runs: fixture.runs,
      coordinator: { reconcile: async () => undefined as never },
      runner,
      concurrency: 2,
      now: () => timestamp,
    })

    await expect(worker.drain([locator])).resolves.toBe(5)
    expect(maximum).toBe(2)
    expect(fixture.events.filter(({ type }) => type === 'NODE_SUCCEEDED')).toHaveLength(5)
  })

  it('claims one attempt once and accepts at most one terminal fact', async () => {
    const fixture = createFixture()
    let release: (() => void) | undefined
    const runner: NodeRunner = {
      run: vi.fn(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ status: 'succeeded', outcome: 'completed', output: {} })
          }),
      ),
      cancel: vi.fn(async () => ({ status: 'cancelled' })),
    }
    const worker = createJournalExecutionWorker({
      runs: fixture.runs,
      coordinator: { reconcile: async () => undefined as never },
      runner,
      concurrency: 2,
      now: () => timestamp,
    })

    const first = worker.runOnce([locator])
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledOnce())
    await expect(worker.runOnce([locator])).resolves.toBe(false)
    await fixture.journal.append({
      eventId: 'external-cancellation',
      timestamp,
      type: 'NODE_CANCELLED',
      data: {
        nodeExecutionId: 'node-execution-0',
        attemptId: 'attempt-0',
        reason: 'Stopped externally',
        durationMs: 0,
      },
    })
    release?.()
    await expect(first).resolves.toBe(true)
    await expect(worker.runOnce([locator])).resolves.toBe(false)
    expect(
      fixture.events.filter(
        ({ type }) =>
          type === 'NODE_SUCCEEDED' || type === 'NODE_FAILED' || type === 'NODE_CANCELLED',
      ),
    ).toEqual([expect.objectContaining({ type: 'NODE_CANCELLED' })])
  })

  it('turns a non-JSON runner result into a bounded failure fact', async () => {
    const fixture = createFixture()
    const worker = createJournalExecutionWorker({
      runs: fixture.runs,
      coordinator: { reconcile: async () => undefined as never },
      runner: {
        async run() {
          return { status: 'succeeded', outcome: 'completed', output: undefined }
        },
        async cancel() {
          return { status: 'cancelled' }
        },
      },
      now: () => timestamp,
    })

    await expect(worker.runOnce([locator])).resolves.toBe(true)
    expect(fixture.events.at(-1)).toMatchObject({
      type: 'NODE_FAILED',
      data: {
        code: 'NODE_RESULT_INVALID',
        message: 'Node runner produced an invalid result',
      },
    })
  })

  it('records confirmed and unconfirmed process termination distinctly', async () => {
    const confirmed = createFixture()
    let finishConfirmed: ((result: { status: 'cancelled'; reason: string }) => void) | undefined
    const confirmedWorker = createJournalExecutionWorker({
      runs: confirmed.runs,
      coordinator: { reconcile: async () => undefined as never },
      runner: {
        run: () =>
          new Promise((resolve) => {
            finishConfirmed = resolve
          }),
        async cancel() {
          finishConfirmed?.({ status: 'cancelled', reason: 'Stopped by user' })
          return { status: 'cancelled' }
        },
      },
      now: () => timestamp,
    })
    const confirmedRun = confirmedWorker.runOnce([locator])
    await vi.waitFor(() => expect(confirmedWorker.executingRunIds()).toEqual(['run-01']))

    await expect(confirmedWorker.cancelRun(locator, 'Stopped by user')).resolves.toEqual({
      status: 'cancelled',
    })
    await confirmedRun
    expect(confirmed.events.filter(({ type }) => type === 'NODE_CANCELLED')).toHaveLength(1)
    expect(
      confirmed.events.filter(({ type }) => type === 'NODE_TERMINATION_UNCONFIRMED'),
    ).toHaveLength(0)

    const unconfirmed = createFixture()
    let finishUnconfirmed:
      ((result: { status: 'failed'; code: string; message: string }) => void) | undefined
    const unconfirmedWorker = createJournalExecutionWorker({
      runs: unconfirmed.runs,
      coordinator: { reconcile: async () => undefined as never },
      runner: {
        run: () =>
          new Promise((resolve) => {
            finishUnconfirmed = resolve
          }),
        async cancel() {
          return { status: 'unconfirmed' }
        },
      },
      now: () => timestamp,
    })
    const unconfirmedRun = unconfirmedWorker.runOnce([locator])
    await vi.waitFor(() => expect(unconfirmedWorker.executingRunIds()).toEqual(['run-01']))

    await expect(unconfirmedWorker.cancelRun(locator, 'Stopped by user')).resolves.toEqual({
      status: 'unconfirmed',
    })
    expect(unconfirmed.events.at(-1)).toMatchObject({
      type: 'NODE_TERMINATION_UNCONFIRMED',
      data: { reason: 'Stopped by user' },
    })
    expect(unconfirmed.events.filter(({ type }) => type === 'NODE_CANCELLED')).toHaveLength(0)
    finishUnconfirmed?.({ status: 'failed', code: 'TEST_FINISHED', message: 'Test finished' })
    await unconfirmedRun
  })
})
