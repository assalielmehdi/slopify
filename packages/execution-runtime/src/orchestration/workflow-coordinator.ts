import { WorkflowRevisionSchema, type WorkflowRevision } from '@loop/workflow-model'
import { z } from 'zod'

import {
  JobCancelledPayloadSchema,
  JobFailedPayloadSchema,
  JobProgressPayloadSchema,
  JobStartedPayloadSchema,
  JobSucceededPayloadSchema,
  type ExecutionMessage,
  type ExecutionMessageQueue,
  type NewExecutionMessage,
} from './execution-messages.js'

export type CoordinatorRunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
export type CoordinatorExecutionStatus =
  'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'

export interface CoordinatorNodeExecution {
  readonly nodeExecutionId: string
  readonly attemptId: string
  readonly nodeId: string
  readonly status: CoordinatorExecutionStatus
  readonly outcome?: string | undefined
  readonly output?: unknown | undefined
}

export interface CoordinatorRunState {
  readonly runId: string
  readonly workflow: WorkflowRevision
  readonly status: CoordinatorRunStatus
  readonly transitionCount: number
  readonly executions: readonly CoordinatorNodeExecution[]
  readonly joinArrivals: Readonly<Record<string, readonly string[]>>
  readonly processedMessageIds: readonly string[]
  readonly events: readonly Readonly<{ type: string; data: unknown; timestamp: string }>[]
  readonly failureCode?: string | undefined
}

export const CoordinatorRunStateSchema = z.strictObject({
  runId: z.string().trim().min(1).max(256),
  workflow: WorkflowRevisionSchema,
  status: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  transitionCount: z.number().int().nonnegative().safe(),
  executions: z.array(
    z.strictObject({
      nodeExecutionId: z.string().trim().min(1).max(256),
      attemptId: z.string().trim().min(1).max(256),
      nodeId: z.string().trim().min(1).max(256),
      status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
      outcome: z.string().trim().min(1).max(256).optional(),
      output: z.json().optional(),
    }),
  ),
  joinArrivals: z.record(z.string(), z.array(z.string())),
  processedMessageIds: z.array(z.string()),
  events: z.array(
    z.strictObject({
      type: z.string().trim().min(1).max(256),
      data: z.json(),
      timestamp: z.iso.datetime({ offset: true }),
    }),
  ),
  failureCode: z.string().trim().min(1).max(256).optional(),
})

export interface CoordinatorStateStore {
  create(state: CoordinatorRunState): void
  createWithCommands?(state: CoordinatorRunState, commands: readonly NewExecutionMessage[]): void
  get(runId: string): CoordinatorRunState | undefined
  update(
    runId: string,
    update: (state: CoordinatorRunState) => CoordinatorRunState,
  ): CoordinatorRunState
  updateAndCompleteClaim?(
    input: Readonly<{
      runId: string
      message: ExecutionMessage
      consumerId: string
      processedAt: string
      update: (state: CoordinatorRunState) => Readonly<{
        state: CoordinatorRunState
        commands: readonly NewExecutionMessage[]
      }>
    }>,
  ): CoordinatorRunState
}

const clone = <Value>(value: Value): Value => structuredClone(value)

export const createInMemoryCoordinatorStateStore = (): CoordinatorStateStore => {
  const states = new Map<string, CoordinatorRunState>()
  return {
    create(state) {
      if (states.has(state.runId)) throw new Error('Coordinator run already exists')
      states.set(state.runId, clone(state))
    },
    get(runId) {
      const state = states.get(runId)
      return state === undefined ? undefined : clone(state)
    },
    update(runId, update) {
      const current = states.get(runId)
      if (current === undefined) throw new Error('Coordinator run was not found')
      const next = update(clone(current))
      states.set(runId, clone(next))
      return clone(next)
    },
  }
}

export interface WorkflowCoordinator {
  start(input: Readonly<{ runId: string; workflow: WorkflowRevision }>): CoordinatorRunState
  runOnce(): boolean
  get(runId: string): CoordinatorRunState | undefined
  cancel(runId: string, reason: string): CoordinatorRunState
}

const jobKind = (node: WorkflowRevision['nodes'][number]): 'agent' | 'command' | 'router' => {
  if (node.type === 'terminal') throw new TypeError('Terminal nodes are not jobs')
  return node.type
}

export const createWorkflowCoordinator = (
  options: Readonly<{
    coordinatorId: string
    queue: ExecutionMessageQueue
    state: CoordinatorStateStore
    leaseDurationMs?: number
    now?: () => string
    createId?: (prefix: string) => string
  }>,
): WorkflowCoordinator => {
  const now = options.now ?? (() => new Date().toISOString())
  const createId = options.createId ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`)
  const leaseDurationMs = options.leaseDurationMs ?? 30_000

  const schedule = (
    state: CoordinatorRunState,
    nodeId: string,
    commands: NewExecutionMessage[],
  ): CoordinatorRunState => {
    const node = state.workflow.nodes.find((candidate) => candidate.id === nodeId)
    if (node === undefined) return { ...state, status: 'FAILED', failureCode: 'WORKFLOW_INVALID' }
    if (node.type === 'terminal') return { ...state, status: node.terminalStatus }
    const nodeExecutionId = createId('node-execution')
    const attemptId = createId('attempt')
    const timestamp = now()
    commands.push({
      id: createId('message'),
      destination: 'WORKER',
      type: 'EXECUTE_JOB',
      runId: state.runId,
      nodeExecutionId,
      attemptId,
      payload: { version: 1, nodeId: node.id, jobKind: jobKind(node) },
      availableAt: timestamp,
      createdAt: timestamp,
    })
    return {
      ...state,
      executions: [...state.executions, { nodeExecutionId, attemptId, nodeId, status: 'PENDING' }],
      events: [
        ...state.events,
        { type: 'JOB_SCHEDULED', data: { nodeId, nodeExecutionId, attemptId }, timestamp },
      ],
    }
  }

  return {
    start(input) {
      const workflow = WorkflowRevisionSchema.parse(input.workflow)
      const timestamp = now()
      let state: CoordinatorRunState = {
        runId: input.runId,
        workflow,
        status: 'RUNNING',
        transitionCount: 0,
        executions: [],
        joinArrivals: {},
        processedMessageIds: [],
        events: [{ type: 'RUN_STARTED', data: {}, timestamp }],
      }
      const commands: NewExecutionMessage[] = []
      state = schedule(state, workflow.startNodeId, commands)
      if (options.state.createWithCommands === undefined) {
        options.state.create(state)
        for (const command of commands) options.queue.enqueue(command)
      } else {
        options.state.createWithCommands(state, commands)
      }
      return state
    },
    get(runId) {
      return options.state.get(runId)
    },
    cancel(runId, reason) {
      const timestamp = now()
      options.queue.cancelPendingRunCommands({ runId, processedAt: timestamp })
      return options.state.update(runId, (current) => {
        if (current.status !== 'RUNNING') return current
        return {
          ...current,
          status: 'CANCELLED',
          executions: current.executions.map((execution) =>
            execution.status === 'PENDING' || execution.status === 'RUNNING'
              ? { ...execution, status: 'CANCELLED' as const }
              : execution,
          ),
          events: [
            ...current.events,
            { type: 'RUN_CANCEL_REQUESTED', data: { reason }, timestamp },
          ],
        }
      })
    },
    runOnce() {
      const message = options.queue.claimNext({
        destination: 'COORDINATOR',
        consumerId: options.coordinatorId,
        now: now(),
        leaseDurationMs,
      })
      if (message === undefined) return false
      const commands: NewExecutionMessage[] = []
      const apply = (current: CoordinatorRunState): CoordinatorRunState => {
        if (current.processedMessageIds.includes(message.id)) return current
        if (current.status !== 'RUNNING')
          return {
            ...current,
            processedMessageIds: [...current.processedMessageIds, message.id],
          }
        const executionIndex = current.executions.findIndex(
          ({ nodeExecutionId, attemptId }) =>
            nodeExecutionId === message.nodeExecutionId && attemptId === message.attemptId,
        )
        if (executionIndex < 0)
          return {
            ...current,
            status: 'FAILED',
            failureCode: 'NODE_EXECUTION_NOT_FOUND',
            processedMessageIds: [...current.processedMessageIds, message.id],
          }
        const execution = current.executions[executionIndex]
        if (execution === undefined) return current
        let next: CoordinatorRunState = {
          ...current,
          processedMessageIds: [...current.processedMessageIds, message.id],
        }
        const replaceExecution = (replacement: CoordinatorNodeExecution) => {
          next = {
            ...next,
            executions: next.executions.map((candidate, index) =>
              index === executionIndex ? replacement : candidate,
            ),
          }
        }
        const append = (type: string, data: unknown, timestamp: string) => {
          next = { ...next, events: [...next.events, { type, data, timestamp }] }
        }
        if (message.type === 'JOB_STARTED') {
          const payload = JobStartedPayloadSchema.parse(message.payload)
          replaceExecution({ ...execution, status: 'RUNNING' })
          append('NODE_STARTED', {}, payload.startedAt)
          return next
        }
        if (message.type === 'JOB_PROGRESS') {
          const payload = JobProgressPayloadSchema.parse(message.payload)
          append(payload.eventType, payload.data, payload.occurredAt)
          return next
        }
        if (message.type === 'JOB_FAILED') {
          const payload = JobFailedPayloadSchema.parse(message.payload)
          replaceExecution({ ...execution, status: 'FAILED' })
          append(
            'NODE_FAILED',
            { code: payload.code, message: payload.message, durationMs: payload.durationMs },
            payload.completedAt,
          )
          return { ...next, status: 'FAILED', failureCode: payload.code }
        }
        if (message.type === 'JOB_CANCELLED') {
          const payload = JobCancelledPayloadSchema.parse(message.payload)
          replaceExecution({ ...execution, status: 'CANCELLED' })
          append(
            'NODE_CANCELLED',
            { code: 'JOB_CANCELLED', message: payload.reason, durationMs: payload.durationMs },
            payload.completedAt,
          )
          return { ...next, status: 'CANCELLED' }
        }
        const payload = JobSucceededPayloadSchema.parse(message.payload)
        if (execution.status === 'SUCCEEDED') return next
        replaceExecution({
          ...execution,
          status: 'SUCCEEDED',
          outcome: payload.outcome,
          output: payload.output,
        })
        append(
          'NODE_COMPLETED',
          {
            outcome: payload.outcome,
            durationMs: payload.durationMs,
            artifactIds: payload.artifactIds,
          },
          payload.completedAt,
        )
        const outgoing = next.workflow.edges.filter(
          (edge) => edge.sourceNodeId === execution.nodeId && edge.outcome === payload.outcome,
        )
        if (outgoing.length === 0)
          return { ...next, status: 'FAILED', failureCode: 'OUTCOME_NOT_ROUTABLE' }
        if (next.transitionCount + outgoing.length > next.workflow.maxTransitions)
          return { ...next, status: 'FAILED', failureCode: 'TRANSITION_LIMIT_EXCEEDED' }
        next = { ...next, transitionCount: next.transitionCount + outgoing.length }
        const targets = new Set<string>()
        for (const edge of outgoing) {
          const arrivals = new Set(next.joinArrivals[edge.targetNodeId] ?? [])
          arrivals.add(execution.nodeId)
          next = {
            ...next,
            joinArrivals: { ...next.joinArrivals, [edge.targetNodeId]: [...arrivals] },
          }
          const requiredSources = new Set(
            next.workflow.edges
              .filter((candidate) => candidate.targetNodeId === edge.targetNodeId)
              .map(({ sourceNodeId }) => sourceNodeId),
          )
          if ([...requiredSources].every((source) => arrivals.has(source)))
            targets.add(edge.targetNodeId)
        }
        for (const target of targets) {
          const remainingArrivals = Object.fromEntries(
            Object.entries(next.joinArrivals).filter(([nodeId]) => nodeId !== target),
          )
          next = { ...next, joinArrivals: remainingArrivals }
          next = schedule(next, target, commands)
          if (next.status !== 'RUNNING') break
        }
        return next
      }
      const processedAt = now()
      if (options.state.updateAndCompleteClaim === undefined) {
        options.state.update(message.runId, (current) => {
          const state = apply(current)
          return state
        })
        options.queue.completeClaim({
          messageId: message.id,
          consumerId: options.coordinatorId,
          processedAt,
          emitted: commands,
        })
      } else {
        options.state.updateAndCompleteClaim({
          runId: message.runId,
          message,
          consumerId: options.coordinatorId,
          processedAt,
          update(current) {
            const state = apply(current)
            return { state, commands }
          },
        })
      }
      return true
    },
  }
}
