import {
  NodeExecutionProjectionSchema,
  RunProjectionSchema,
  RunWorkspacesProjectionSchema,
  type NodeExecutionProjection,
  type RunProjection,
  type RunWorkspacesProjection,
} from './run-artifacts.js'
import { RunDomainEventSchema, type RunDomainEvent } from './run-events.js'

export type RunProjectionErrorCode =
  'EVENT_CONFLICT' | 'EVENT_REFERENCE_INVALID' | 'EVENT_RUN_MISMATCH' | 'EVENT_SEQUENCE_INVALID'

export class RunProjectionError extends Error {
  override readonly name = 'RunProjectionError'

  constructor(
    readonly code: RunProjectionErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface RunRoutingProjection {
  readonly traversed: readonly string[]
  readonly joinArrivals: Readonly<Record<string, readonly string[]>>
}

export interface RunProjectionState {
  readonly run: RunProjection
  readonly workspaces: RunWorkspacesProjection
  readonly executions: readonly NodeExecutionProjection[]
  readonly routing: RunRoutingProjection
  readonly processedEventIds: readonly string[]
  readonly scheduleKeys: readonly string[]
}

export const createRunProjectionState = (input: {
  readonly run: RunProjection
  readonly workspaces: RunWorkspacesProjection
}): RunProjectionState => {
  const run = RunProjectionSchema.parse(input.run)
  const workspaces = RunWorkspacesProjectionSchema.parse(input.workspaces)
  if (run.runId !== workspaces.runId) {
    throw new TypeError('Run and workspace projections must belong to the same run')
  }
  if (run.lastEventSequence !== workspaces.lastEventSequence) {
    throw new TypeError('Run and workspace projections must use the same event sequence')
  }
  return {
    run: structuredClone(run),
    workspaces: structuredClone(workspaces),
    executions: [],
    routing: { traversed: [], joinArrivals: {} },
    processedEventIds: [],
    scheduleKeys: [],
  }
}

const advance = (state: RunProjectionState, sequence: number): RunProjectionState => ({
  ...state,
  run: { ...state.run, lastEventSequence: sequence },
  workspaces: { ...state.workspaces, lastEventSequence: sequence },
  executions: state.executions.map((execution) => ({
    ...execution,
    lastEventSequence: sequence,
  })),
})

const replaceExecution = (
  state: RunProjectionState,
  nodeExecutionId: string,
  attemptId: string,
  update: (execution: NodeExecutionProjection) => NodeExecutionProjection,
): RunProjectionState => {
  const index = state.executions.findIndex(
    (execution) => execution.nodeExecutionId === nodeExecutionId,
  )
  if (index < 0) {
    throw new RunProjectionError(
      'EVENT_REFERENCE_INVALID',
      `Node execution ${nodeExecutionId} was not scheduled`,
    )
  }
  if (state.executions[index]?.attemptId !== attemptId) {
    throw new RunProjectionError(
      'EVENT_REFERENCE_INVALID',
      `Node execution ${nodeExecutionId} attempt does not match`,
    )
  }
  return {
    ...state,
    executions: state.executions.map((execution, candidateIndex) =>
      candidateIndex === index ? NodeExecutionProjectionSchema.parse(update(execution)) : execution,
    ),
  }
}

const replaceWorkspace = (
  state: RunProjectionState,
  repositoryId: string,
  update: (
    workspace: RunWorkspacesProjection['workspaces'][number],
  ) => RunWorkspacesProjection['workspaces'][number],
): RunProjectionState => {
  const index = state.workspaces.workspaces.findIndex(
    (workspace) => workspace.repositoryId === repositoryId,
  )
  if (index < 0) {
    throw new RunProjectionError(
      'EVENT_REFERENCE_INVALID',
      `Repository workspace ${repositoryId} was not prepared`,
    )
  }
  return {
    ...state,
    workspaces: {
      ...state.workspaces,
      workspaces: state.workspaces.workspaces.map((workspace, candidateIndex) =>
        candidateIndex === index ? update(workspace) : workspace,
      ),
    },
  }
}

const applyRunEvent = (
  unadvanced: RunProjectionState,
  event: RunDomainEvent,
): RunProjectionState => {
  let state = unadvanced
  switch (event.type) {
    case 'RUN_STARTED':
      state = {
        ...state,
        run: { ...state.run, status: 'RUNNING', startedAt: event.timestamp },
      }
      break
    case 'RUN_CANCEL_REQUESTED':
      break
    case 'RUN_SUCCEEDED':
      state = {
        ...state,
        run: { ...state.run, status: 'SUCCEEDED', completedAt: event.timestamp },
      }
      break
    case 'RUN_FAILED':
      state = {
        ...state,
        run: {
          ...state.run,
          status: 'FAILED',
          completedAt: event.timestamp,
          failureCode: event.data.code,
        },
      }
      break
    case 'RUN_CANCELLED':
      state = {
        ...state,
        run: { ...state.run, status: 'CANCELLED', completedAt: event.timestamp },
        executions: state.executions.map((execution) =>
          execution.status === 'PENDING' || execution.status === 'RUNNING'
            ? { ...execution, status: 'CANCELLED', completedAt: event.timestamp }
            : execution,
        ),
      }
      break
    case 'WORKSPACE_PREPARING': {
      if (
        state.workspaces.workspaces.some(
          (workspace) => workspace.repositoryId === event.data.repositoryId,
        )
      ) {
        throw new RunProjectionError('EVENT_CONFLICT', 'Repository workspace already exists')
      }
      state = {
        ...state,
        workspaces: {
          ...state.workspaces,
          workspaces: [
            ...state.workspaces.workspaces,
            {
              repositoryId: event.data.repositoryId,
              position: event.data.position,
              status: 'PREPARING',
              workspacePath: event.data.workspacePath,
              branchName: event.data.branchName,
              errorMessage: null,
              preparedAt: null,
              cleanedAt: null,
              updatedAt: event.timestamp,
            },
          ],
        },
      }
      break
    }
    case 'WORKSPACE_READY':
      state = replaceWorkspace(state, event.data.repositoryId, (workspace) => ({
        ...workspace,
        status: 'READY',
        preparedAt: event.timestamp,
        updatedAt: event.timestamp,
      }))
      break
    case 'WORKSPACE_FAILED':
      state = replaceWorkspace(state, event.data.repositoryId, (workspace) => ({
        ...workspace,
        status: 'FAILED',
        errorMessage: event.data.errorMessage,
        updatedAt: event.timestamp,
      }))
      break
    case 'WORKSPACE_CLEANED':
      state = replaceWorkspace(state, event.data.repositoryId, (workspace) => ({
        ...workspace,
        status: 'CLEANED',
        cleanedAt: event.timestamp,
        updatedAt: event.timestamp,
      }))
      break
    case 'NODE_SCHEDULED': {
      const scheduleKey = `${event.data.causationId}:${event.data.nodeId}`
      if (state.scheduleKeys.includes(scheduleKey)) break
      if (
        state.executions.some(
          (execution) =>
            execution.nodeExecutionId === event.data.nodeExecutionId ||
            execution.executionIndex === event.data.executionIndex,
        )
      ) {
        throw new RunProjectionError('EVENT_CONFLICT', 'Node execution already exists')
      }
      state = {
        ...state,
        scheduleKeys: [...state.scheduleKeys, scheduleKey],
        executions: [
          ...state.executions,
          NodeExecutionProjectionSchema.parse({
            schemaVersion: 1,
            runId: state.run.runId,
            nodeExecutionId: event.data.nodeExecutionId,
            attemptId: event.data.attemptId,
            nodeId: event.data.nodeId,
            executionIndex: event.data.executionIndex,
            status: 'PENDING',
            lastEventSequence: event.sequence,
            output: null,
            outcome: null,
            errorCode: null,
            errorMessage: null,
            startedAt: null,
            completedAt: null,
            durationMs: null,
            session: null,
          }),
        ],
      }
      break
    }
    case 'NODE_STARTED':
      state = replaceExecution(
        state,
        event.data.nodeExecutionId,
        event.data.attemptId,
        (execution) => ({
          ...execution,
          status: 'RUNNING',
          startedAt: event.timestamp,
        }),
      )
      break
    case 'NODE_SUCCEEDED':
      state = replaceExecution(
        state,
        event.data.nodeExecutionId,
        event.data.attemptId,
        (execution) => ({
          ...execution,
          status: 'SUCCEEDED',
          output: event.data.output,
          outcome: event.data.outcome,
          completedAt: event.timestamp,
          durationMs: event.data.durationMs,
          session: event.data.session ?? null,
        }),
      )
      break
    case 'NODE_FAILED':
      state = replaceExecution(
        state,
        event.data.nodeExecutionId,
        event.data.attemptId,
        (execution) => ({
          ...execution,
          status: 'FAILED',
          errorCode: event.data.code,
          errorMessage: event.data.message,
          completedAt: event.timestamp,
          durationMs: event.data.durationMs,
          session: event.data.session ?? null,
        }),
      )
      break
    case 'NODE_CANCELLED':
      state = replaceExecution(
        state,
        event.data.nodeExecutionId,
        event.data.attemptId,
        (execution) => ({
          ...execution,
          status: 'CANCELLED',
          errorMessage: event.data.reason,
          completedAt: event.timestamp,
          durationMs: event.data.durationMs,
          session: event.data.session ?? null,
        }),
      )
      break
    case 'NODE_TERMINATION_UNCONFIRMED':
      state = replaceExecution(
        state,
        event.data.nodeExecutionId,
        event.data.attemptId,
        (execution) => execution,
      )
      break
    case 'ROUTE_TRAVERSED': {
      const routeKey = `${event.data.sourceNodeExecutionId}:${event.data.targetNodeId}:${event.data.outcome}`
      if (state.routing.traversed.includes(routeKey)) break
      const arrivals = state.routing.joinArrivals[event.data.targetNodeId] ?? []
      state = {
        ...state,
        run: { ...state.run, transitionCount: state.run.transitionCount + 1 },
        routing: {
          traversed: [...state.routing.traversed, routeKey],
          joinArrivals: {
            ...state.routing.joinArrivals,
            [event.data.targetNodeId]: arrivals.includes(event.data.sourceNodeId)
              ? arrivals
              : [...arrivals, event.data.sourceNodeId],
          },
        },
      }
      break
    }
    case 'JOIN_RELEASED': {
      const joinArrivals = Object.fromEntries(
        Object.entries(state.routing.joinArrivals).filter(
          ([targetNodeId]) => targetNodeId !== event.data.targetNodeId,
        ),
      )
      state = { ...state, routing: { ...state.routing, joinArrivals } }
      break
    }
  }
  return advance(state, event.sequence)
}

export const reduceRunEvents = (
  input: RunProjectionState,
  events: readonly RunDomainEvent[],
): RunProjectionState => {
  let state = structuredClone(input)
  for (const eventInput of events) {
    const event = RunDomainEventSchema.parse(eventInput)
    if (state.processedEventIds.includes(event.eventId)) continue
    if (event.runId !== state.run.runId) {
      throw new RunProjectionError('EVENT_RUN_MISMATCH', 'Event belongs to a different run')
    }
    if (event.sequence !== state.run.lastEventSequence + 1) {
      throw new RunProjectionError('EVENT_SEQUENCE_INVALID', 'Event sequence must be contiguous')
    }
    state = applyRunEvent(state, event)
    state = { ...state, processedEventIds: [...state.processedEventIds, event.eventId] }
  }
  return state
}
