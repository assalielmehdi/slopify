import { describe, expect, it } from 'vitest'

import {
  createInMemoryCoordinatorStateStore,
  createInMemoryExecutionMessageQueue,
  createWorkflowCoordinator,
} from '../../src/index.js'

const agent = (id: string) => ({
  type: 'agent' as const,
  id,
  name: id,
  prompt: `Run ${id}`,
  harness: {
    harnessId: 'pi' as const,
    modelId: 'openai/gpt-5.4',
    thinkingLevel: 'medium' as const,
  },
})

const workflow = {
  schemaVersion: 1 as const,
  workflowId: 'workflow-01',
  name: 'Parallel workflow',
  description: 'Exercises fan-out and a deterministic join.',
  configuration: { projectIds: [], primaryProjectId: null, variables: [] },
  startNodeId: 'start',
  nodes: [agent('start'), agent('left'), agent('right'), agent('join')],
  edges: [
    { sourceNodeId: 'start', outcome: 'split', targetNodeId: 'left', label: 'Left' },
    { sourceNodeId: 'start', outcome: 'split', targetNodeId: 'right', label: 'Right' },
    { sourceNodeId: 'left', outcome: 'ready', targetNodeId: 'join', label: 'Left ready' },
    { sourceNodeId: 'right', outcome: 'ready', targetNodeId: 'join', label: 'Right ready' },
  ],
  maxTransitions: 8,
  createdAt: '2026-08-20T10:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
}

const timestamp = '2026-08-20T10:00:00.000Z'

describe('workflow coordinator', () => {
  it('completes a run when its leaf agent succeeds', () => {
    const queue = createInMemoryExecutionMessageQueue()
    const state = createInMemoryCoordinatorStateStore()
    const coordinator = createWorkflowCoordinator({
      coordinatorId: 'coordinator-01',
      queue,
      state,
      now: () => timestamp,
    })
    coordinator.start({
      runId: 'run-leaf',
      workflow: {
        ...workflow,
        name: 'Leaf agent',
        startNodeId: 'leaf',
        nodes: [agent('leaf')],
        edges: [],
        maxTransitions: 0,
      },
    })
    const leaf = state.get('run-leaf')?.executions[0]
    if (leaf === undefined) throw new Error('leaf execution missing')
    queue.enqueue({
      id: 'success-leaf',
      destination: 'COORDINATOR',
      type: 'NODE_EXECUTION_SUCCEEDED',
      runId: 'run-leaf',
      nodeExecutionId: leaf.nodeExecutionId,
      attemptId: leaf.attemptId,
      payload: {
        version: 1,
        outcome: 'completed',
        output: {},
        completedAt: timestamp,
        durationMs: 1,
      },
      availableAt: timestamp,
      createdAt: timestamp,
    })

    coordinator.runOnce()

    expect(state.get('run-leaf')).toMatchObject({
      status: 'SUCCEEDED',
      transitionCount: 0,
      executions: [expect.objectContaining({ nodeId: 'leaf', status: 'SUCCEEDED' })],
    })
  })

  it('owns graph routing, schedules fan-out concurrently, and waits for every join input', () => {
    const queue = createInMemoryExecutionMessageQueue()
    const state = createInMemoryCoordinatorStateStore()
    let nextId = 0
    const coordinator = createWorkflowCoordinator({
      coordinatorId: 'coordinator-01',
      queue,
      state,
      now: () => timestamp,
      createId: (prefix) => `${prefix}-${++nextId}`,
    })

    coordinator.start({ runId: 'run-01', workflow })
    expect(queue.list({ destination: 'WORKER', status: 'PENDING' })).toHaveLength(1)

    const succeed = (nodeExecutionId: string, attemptId: string, outcome: string) => {
      const messageId = `success-${nodeExecutionId}`
      queue.enqueue({
        id: messageId,
        destination: 'COORDINATOR',
        type: 'NODE_EXECUTION_SUCCEEDED',
        runId: 'run-01',
        nodeExecutionId,
        attemptId,
        payload: {
          version: 1,
          outcome,
          output: {},
          completedAt: timestamp,
          durationMs: 1,
        },
        availableAt: timestamp,
        createdAt: timestamp,
      })
      expect(coordinator.runOnce()).toBe(true)
    }

    const start = state.get('run-01')?.executions[0]
    if (start === undefined) throw new Error('start execution missing')
    succeed(start.nodeExecutionId, start.attemptId, 'split')

    const afterFanOut = state.get('run-01')
    const branches =
      afterFanOut?.executions.filter(({ nodeId }) => nodeId === 'left' || nodeId === 'right') ?? []
    expect(branches.map(({ nodeId }) => nodeId).sort()).toEqual(['left', 'right'])
    expect(queue.list({ destination: 'WORKER', status: 'PENDING' })).toHaveLength(3)

    const left = branches.find(({ nodeId }) => nodeId === 'left')
    const right = branches.find(({ nodeId }) => nodeId === 'right')
    if (left === undefined || right === undefined) throw new Error('branch execution missing')
    succeed(left.nodeExecutionId, left.attemptId, 'ready')
    expect(state.get('run-01')?.executions.some(({ nodeId }) => nodeId === 'join')).toBe(false)

    succeed(right.nodeExecutionId, right.attemptId, 'ready')
    expect(state.get('run-01')?.executions.filter(({ nodeId }) => nodeId === 'join')).toHaveLength(
      1,
    )
  })

  it('keeps a fan-out run active until every leaf branch completes', () => {
    const queue = createInMemoryExecutionMessageQueue()
    const state = createInMemoryCoordinatorStateStore()
    let nextId = 0
    const coordinator = createWorkflowCoordinator({
      coordinatorId: 'coordinator-01',
      queue,
      state,
      now: () => timestamp,
      createId: (prefix) => `${prefix}-${++nextId}`,
    })
    coordinator.start({
      runId: 'run-independent-leaves',
      workflow: {
        ...workflow,
        name: 'Independent leaves',
        nodes: [agent('start'), agent('left'), agent('right')],
        edges: workflow.edges.slice(0, 2),
      },
    })

    const succeed = (nodeId: string, outcome: string) => {
      const execution = state
        .get('run-independent-leaves')
        ?.executions.find((candidate) => candidate.nodeId === nodeId)
      if (execution === undefined) throw new Error(`${nodeId} execution missing`)
      queue.enqueue({
        id: `success-${nodeId}`,
        destination: 'COORDINATOR',
        type: 'NODE_EXECUTION_SUCCEEDED',
        runId: 'run-independent-leaves',
        nodeExecutionId: execution.nodeExecutionId,
        attemptId: execution.attemptId,
        payload: {
          version: 1,
          outcome,
          output: {},
          completedAt: timestamp,
          durationMs: 1,
        },
        availableAt: timestamp,
        createdAt: timestamp,
      })
      coordinator.runOnce()
    }

    succeed('start', 'split')
    succeed('left', 'completed')
    expect(state.get('run-independent-leaves')?.status).toBe('RUNNING')

    succeed('right', 'completed')
    expect(state.get('run-independent-leaves')?.status).toBe('SUCCEEDED')
  })

  it('fails deterministically when fan-out would exceed the transition limit', () => {
    const queue = createInMemoryExecutionMessageQueue()
    const state = createInMemoryCoordinatorStateStore()
    const coordinator = createWorkflowCoordinator({
      coordinatorId: 'coordinator-01',
      queue,
      state,
      now: () => timestamp,
    })
    coordinator.start({ runId: 'run-01', workflow: { ...workflow, maxTransitions: 1 } })
    const start = state.get('run-01')?.executions[0]
    if (start === undefined) throw new Error('start execution missing')
    queue.enqueue({
      id: 'success-start',
      destination: 'COORDINATOR',
      type: 'NODE_EXECUTION_SUCCEEDED',
      runId: 'run-01',
      nodeExecutionId: start.nodeExecutionId,
      attemptId: start.attemptId,
      payload: {
        version: 1,
        outcome: 'split',
        output: {},
        completedAt: timestamp,
        durationMs: 1,
      },
      availableAt: timestamp,
      createdAt: timestamp,
    })

    coordinator.runOnce()

    expect(state.get('run-01')).toMatchObject({
      status: 'FAILED',
      failureCode: 'TRANSITION_LIMIT_EXCEEDED',
    })
  })

  it('cancels pending work and terminalizes every active attempt', () => {
    const queue = createInMemoryExecutionMessageQueue()
    const state = createInMemoryCoordinatorStateStore()
    const coordinator = createWorkflowCoordinator({
      coordinatorId: 'coordinator-01',
      queue,
      state,
      now: () => timestamp,
    })
    coordinator.start({ runId: 'run-01', workflow })

    expect(coordinator.cancel('run-01', 'Stopped by user')).toMatchObject({
      status: 'CANCELLED',
      executions: [expect.objectContaining({ status: 'CANCELLED' })],
    })
    expect(queue.list({ destination: 'WORKER', status: 'PENDING' })).toHaveLength(0)
    expect(state.get('run-01')?.events.at(-1)).toMatchObject({
      type: 'RUN_CANCEL_REQUESTED',
      data: { reason: 'Stopped by user' },
    })
  })
})
