import type { Workflow } from '@slopify/workflow-model'
import { describe, expect, it } from 'vitest'

import {
  RunDomainEventSchema,
  createJournalWorkflowCoordinator,
  createRunProjectionState,
  reduceRunEvents,
  type NewRunDomainEvent,
  type RunDomainEvent,
  type RunJournal,
  type RunProjectionState,
} from '../../src/index.js'

const timestamp = '2026-08-25T10:00:00.000Z'
const agent = (id: string) => ({
  type: 'agent' as const,
  id,
  name: id,
  prompt: `Run ${id}.`,
  harness: { harnessId: 'pi' as const },
})

const workflow: Workflow = {
  schemaVersion: 2,
  workflowId: 'parallel-review',
  name: 'Parallel review',
  description: 'Exercise fan-out and joins.',
  configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
  startNodeId: 'start',
  nodes: [agent('start'), agent('left'), agent('right'), agent('join')],
  edges: [
    { sourceNodeId: 'start', outcome: 'split', targetNodeId: 'left', label: 'Left' },
    { sourceNodeId: 'start', outcome: 'split', targetNodeId: 'right', label: 'Right' },
    { sourceNodeId: 'left', outcome: 'ready', targetNodeId: 'join', label: 'Left ready' },
    { sourceNodeId: 'right', outcome: 'ready', targetNodeId: 'join', label: 'Right ready' },
  ],
  maxTransitions: 8,
  createdAt: timestamp,
  updatedAt: timestamp,
}

const createFixture = (definition: Workflow = workflow) => {
  const events: RunDomainEvent[] = []
  const initial = createRunProjectionState({
    run: {
      schemaVersion: 1,
      runId: 'run-01',
      workflowId: definition.workflowId,
      status: 'PENDING',
      transitionCount: 0,
      lastEventSequence: 0,
      createdAt: timestamp,
      startedAt: null,
      completedAt: null,
      failureCode: null,
    },
    workspaces: {
      schemaVersion: 1,
      runId: 'run-01',
      lastEventSequence: 0,
      workspaces: [],
    },
  })
  const projection = (): RunProjectionState => reduceRunEvents(initial, events)
  const journal: RunJournal = {
    async append(input: NewRunDomainEvent) {
      const existing = events.find(({ eventId }) => eventId === input.eventId)
      if (existing !== undefined) return existing
      const appended = RunDomainEventSchema.parse({
        ...input,
        schemaVersion: 1,
        runId: 'run-01',
        sequence: events.length + 1,
      })
      events.push(appended)
      return appended
    },
    async replay() {
      return { status: 'READY', events: structuredClone(events), recoveredBytes: 0 }
    },
    async repairProjections() {
      return {
        status: 'READY',
        events: structuredClone(events),
        recoveredBytes: 0,
        projection: projection(),
        repaired: false,
      }
    },
  }
  const coordinator = createJournalWorkflowCoordinator({
    runs: {
      async load({ runId }) {
        return runId === 'run-01' ? { workflow: definition, journal } : undefined
      },
    },
    now: () => timestamp,
  })
  const succeed = async (nodeId: string, outcome: string) => {
    const execution = projection().executions.find(
      (candidate) => candidate.nodeId === nodeId && candidate.status === 'PENDING',
    )
    if (execution === undefined) throw new Error(`Pending ${nodeId} execution was not found`)
    await journal.append({
      eventId: `worker-success-${execution.nodeExecutionId}`,
      timestamp,
      type: 'NODE_SUCCEEDED',
      data: {
        nodeExecutionId: execution.nodeExecutionId,
        attemptId: execution.attemptId,
        outcome,
        output: {},
        durationMs: 1,
      },
    })
    return coordinator.reconcile({ workflowId: definition.workflowId, runId: 'run-01' })
  }
  return { coordinator, events, projection, succeed }
}

describe('journal workflow coordinator', () => {
  it('journals start, leaf scheduling, and terminal completion idempotently', async () => {
    const fixture = createFixture({
      ...workflow,
      name: 'Leaf review',
      startNodeId: 'leaf',
      nodes: [agent('leaf')],
      edges: [],
      maxTransitions: 0,
    })

    await fixture.coordinator.start({ workflowId: 'parallel-review', runId: 'run-01' })
    await fixture.coordinator.start({ workflowId: 'parallel-review', runId: 'run-01' })
    expect(fixture.events.map(({ type }) => type)).toEqual(['RUN_STARTED', 'NODE_SCHEDULED'])

    fixture.events.pop()
    await fixture.coordinator.reconcile({ workflowId: 'parallel-review', runId: 'run-01' })
    expect(fixture.events.map(({ type }) => type)).toEqual(['RUN_STARTED', 'NODE_SCHEDULED'])

    await fixture.succeed('leaf', 'completed')
    expect(fixture.projection().run.status).toBe('SUCCEEDED')
    expect(fixture.events.map(({ type }) => type)).toEqual([
      'RUN_STARTED',
      'NODE_SCHEDULED',
      'NODE_SUCCEEDED',
      'RUN_SUCCEEDED',
    ])
    const count = fixture.events.length
    await fixture.coordinator.reconcile({ workflowId: 'parallel-review', runId: 'run-01' })
    expect(fixture.events).toHaveLength(count)
  })

  it('journals fan-out routes and releases a join exactly once', async () => {
    const fixture = createFixture()
    await fixture.coordinator.start({ workflowId: 'parallel-review', runId: 'run-01' })

    await fixture.succeed('start', 'split')
    expect(
      fixture
        .projection()
        .executions.map(({ nodeId }) => nodeId)
        .sort(),
    ).toEqual(['left', 'right', 'start'])
    expect(fixture.events.filter(({ type }) => type === 'ROUTE_TRAVERSED')).toHaveLength(2)

    await fixture.succeed('left', 'ready')
    expect(fixture.projection().executions.some(({ nodeId }) => nodeId === 'join')).toBe(false)
    await fixture.succeed('right', 'ready')
    const joinScheduleIndex = fixture.events.findIndex(
      (event) => event.type === 'NODE_SCHEDULED' && event.data.nodeId === 'join',
    )
    expect(joinScheduleIndex).toBe(fixture.events.length - 1)
    fixture.events.splice(joinScheduleIndex, 1)
    await fixture.coordinator.reconcile({ workflowId: 'parallel-review', runId: 'run-01' })
    expect(fixture.projection().executions.filter(({ nodeId }) => nodeId === 'join')).toHaveLength(
      1,
    )
    expect(fixture.events.filter(({ type }) => type === 'JOIN_RELEASED')).toHaveLength(3)
    const reconciledCount = fixture.events.length
    await fixture.coordinator.reconcile({ workflowId: 'parallel-review', runId: 'run-01' })
    expect(fixture.events).toHaveLength(reconciledCount)

    await fixture.succeed('join', 'completed')
    expect(fixture.projection().run).toMatchObject({ status: 'SUCCEEDED', transitionCount: 4 })
    expect(fixture.events.filter(({ type }) => type === 'NODE_SCHEDULED')).toHaveLength(4)
  })

  it('journals unroutable outcomes and transition-limit failures', async () => {
    const unroutable = createFixture()
    await unroutable.coordinator.start({ workflowId: 'parallel-review', runId: 'run-01' })
    await unroutable.succeed('start', 'unknown')
    expect(unroutable.projection().run).toMatchObject({
      status: 'FAILED',
      failureCode: 'OUTCOME_NOT_ROUTABLE',
    })

    const limited = createFixture({ ...workflow, maxTransitions: 1 })
    await limited.coordinator.start({ workflowId: 'parallel-review', runId: 'run-01' })
    await limited.succeed('start', 'split')
    expect(limited.projection().run).toMatchObject({
      status: 'FAILED',
      transitionCount: 0,
      failureCode: 'TRANSITION_LIMIT_EXCEEDED',
    })
  })
})
