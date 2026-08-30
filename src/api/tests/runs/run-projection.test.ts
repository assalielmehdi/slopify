import { describe, expect, it } from 'vitest'

import {
  RunDomainEventSchema,
  RunProjectionError,
  createRunProjectionState,
  reduceRunEvents,
  type RunDomainEvent,
} from '../../src/index.js'

const timestamp = '2026-08-25T10:00:00.000Z'

const event = (sequence: number, type: RunDomainEvent['type'], data: unknown): RunDomainEvent =>
  RunDomainEventSchema.parse({
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    runId: 'run-01',
    sequence,
    timestamp,
    type,
    data,
  })

const initial = () =>
  createRunProjectionState({
    run: {
      schemaVersion: 1,
      runId: 'run-01',
      workflowId: 'release-review',
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

describe('run domain events', () => {
  it('uses strict, schema-versioned event records', () => {
    expect(event(1, 'RUN_STARTED', {})).toMatchObject({
      schemaVersion: 1,
      type: 'RUN_STARTED',
    })
    expect(
      RunDomainEventSchema.safeParse({
        ...event(1, 'RUN_STARTED', {}),
        unexpected: true,
      }).success,
    ).toBe(false)
  })
})

describe('run projection reducer', () => {
  it('projects workspace, execution, routing, join, and terminal facts', () => {
    const state = reduceRunEvents(initial(), [
      event(1, 'RUN_STARTED', {}),
      event(2, 'WORKSPACE_PREPARING', {
        repositoryId: 'repository-api',
        position: 0,
        workspacePath: '/tmp/run-01/repository-api',
        branchName: 'slopify/run-01',
      }),
      event(3, 'WORKSPACE_READY', { repositoryId: 'repository-api' }),
      event(4, 'NODE_SCHEDULED', {
        nodeExecutionId: 'node-execution-start',
        attemptId: 'attempt-start',
        nodeId: 'start',
        executionIndex: 0,
        causationId: 'event-1',
      }),
      event(5, 'NODE_STARTED', {
        nodeExecutionId: 'node-execution-start',
        attemptId: 'attempt-start',
      }),
      event(6, 'NODE_SUCCEEDED', {
        nodeExecutionId: 'node-execution-start',
        attemptId: 'attempt-start',
        outcome: 'ready',
        output: { reviewed: true },
        session: {
          sessionId: 'session-start',
          openCommand: 'codex resume session-start',
        },
        durationMs: 25,
      }),
      event(7, 'ROUTE_TRAVERSED', {
        sourceNodeExecutionId: 'node-execution-start',
        sourceNodeId: 'start',
        targetNodeId: 'finish',
        outcome: 'ready',
      }),
      event(8, 'JOIN_RELEASED', {
        targetNodeId: 'finish',
        causationId: 'event-7',
      }),
      event(9, 'NODE_SCHEDULED', {
        nodeExecutionId: 'node-execution-finish',
        attemptId: 'attempt-finish',
        nodeId: 'finish',
        executionIndex: 1,
        causationId: 'event-8',
      }),
      event(10, 'NODE_STARTED', {
        nodeExecutionId: 'node-execution-finish',
        attemptId: 'attempt-finish',
      }),
      event(11, 'NODE_SUCCEEDED', {
        nodeExecutionId: 'node-execution-finish',
        attemptId: 'attempt-finish',
        outcome: 'completed',
        output: null,
        durationMs: 10,
      }),
      event(12, 'RUN_SUCCEEDED', {}),
      event(13, 'WORKSPACE_CLEANED', { repositoryId: 'repository-api' }),
    ])

    expect(state.run).toMatchObject({
      status: 'SUCCEEDED',
      transitionCount: 1,
      lastEventSequence: 13,
      startedAt: timestamp,
      completedAt: timestamp,
    })
    expect(state.executions).toEqual([
      expect.objectContaining({
        nodeId: 'start',
        status: 'SUCCEEDED',
        outcome: 'ready',
        output: { reviewed: true },
        session: {
          sessionId: 'session-start',
          openCommand: 'codex resume session-start',
        },
      }),
      expect.objectContaining({ nodeId: 'finish', status: 'SUCCEEDED', session: null }),
    ])
    expect(state.workspaces.workspaces).toEqual([
      expect.objectContaining({ repositoryId: 'repository-api', status: 'CLEANED' }),
    ])
    expect(state.routing).toEqual({
      traversed: ['node-execution-start:finish:ready'],
      joinArrivals: {},
    })
  })

  it('ignores replayed facts and duplicate causal schedules', () => {
    const started = event(1, 'RUN_STARTED', {})
    const scheduled = event(2, 'NODE_SCHEDULED', {
      nodeExecutionId: 'node-execution-start',
      attemptId: 'attempt-start',
      nodeId: 'start',
      executionIndex: 0,
      causationId: 'event-1',
    })
    const routed = event(3, 'ROUTE_TRAVERSED', {
      sourceNodeExecutionId: 'node-execution-start',
      sourceNodeId: 'start',
      targetNodeId: 'finish',
      outcome: 'ready',
    })
    const once = reduceRunEvents(initial(), [started, scheduled, routed])

    expect(reduceRunEvents(once, [routed])).toEqual(once)
    const duplicateSchedule = event(4, 'NODE_SCHEDULED', {
      nodeExecutionId: 'node-execution-duplicate',
      attemptId: 'attempt-duplicate',
      nodeId: 'start',
      executionIndex: 1,
      causationId: 'event-1',
    })
    const deduplicated = reduceRunEvents(once, [duplicateSchedule])
    expect(deduplicated.executions).toHaveLength(1)
    expect(deduplicated.run.lastEventSequence).toBe(4)
    expect(deduplicated.run.transitionCount).toBe(1)
  })

  it('matches current coordinator terminal semantics for failure and cancellation', () => {
    const failed = reduceRunEvents(initial(), [
      event(1, 'RUN_STARTED', {}),
      event(2, 'RUN_FAILED', { code: 'TRANSITION_LIMIT_EXCEEDED' }),
    ])
    const cancelled = reduceRunEvents(initial(), [
      event(1, 'RUN_STARTED', {}),
      event(2, 'RUN_CANCEL_REQUESTED', { reason: 'Stopped by user' }),
      event(3, 'RUN_CANCELLED', {}),
    ])

    expect(failed.run).toMatchObject({
      status: 'FAILED',
      failureCode: 'TRANSITION_LIMIT_EXCEEDED',
    })
    expect(cancelled.run).toMatchObject({ status: 'CANCELLED', failureCode: null })
  })

  it('rejects gaps and facts for a different run', () => {
    expect(() => reduceRunEvents(initial(), [event(2, 'RUN_STARTED', {})])).toThrowError(
      expect.objectContaining({
        code: 'EVENT_SEQUENCE_INVALID',
      } satisfies Partial<RunProjectionError>),
    )
    expect(() =>
      reduceRunEvents(initial(), [
        RunDomainEventSchema.parse({ ...event(1, 'RUN_STARTED', {}), runId: 'run-other' }),
      ]),
    ).toThrowError(
      expect.objectContaining({ code: 'EVENT_RUN_MISMATCH' } satisfies Partial<RunProjectionError>),
    )

    const scheduled = reduceRunEvents(initial(), [
      event(1, 'RUN_STARTED', {}),
      event(2, 'NODE_SCHEDULED', {
        nodeExecutionId: 'node-execution-start',
        attemptId: 'attempt-start',
        nodeId: 'start',
        executionIndex: 0,
        causationId: 'event-1',
      }),
    ])
    expect(() =>
      reduceRunEvents(scheduled, [
        event(3, 'NODE_STARTED', {
          nodeExecutionId: 'node-execution-start',
          attemptId: 'attempt-other',
        }),
      ]),
    ).toThrowError(
      expect.objectContaining({
        code: 'EVENT_REFERENCE_INVALID',
      } satisfies Partial<RunProjectionError>),
    )
  })
})
