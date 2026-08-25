import { createHash } from 'node:crypto'

import { NodeIdSchema } from '@slopify/contracts'
import { WorkflowSchema } from '@slopify/workflow-model'

import type { RunDomainEvent } from '../runs/run-events.js'
import type { RunJournal } from '../runs/run-journal.js'
import type { RunProjectionState } from '../runs/run-projection.js'
import type { FilesystemRunWorkspaceProvisioner } from '../workspaces/run-workspace-provisioner.js'
import type { JournalCoordinatorStore } from './journal-coordinator-store.js'

export type JournalCoordinatorErrorCode =
  | 'JOURNAL_RECONCILE_LIMIT_EXCEEDED'
  | 'RUN_JOURNAL_CORRUPT'
  | 'RUN_NOT_CANCELLABLE'
  | 'RUN_NOT_FOUND'
  | 'WORKFLOW_NOT_RUNNABLE'

export class JournalCoordinatorError extends Error {
  override readonly name = 'JournalCoordinatorError'

  constructor(
    readonly code: JournalCoordinatorErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface JournalWorkflowCoordinator {
  start(input: Readonly<{ workflowId: string; runId: string }>): Promise<RunProjectionState>
  requestCancellation(
    input: Readonly<{ workflowId: string; runId: string; reason: string }>,
  ): Promise<RunProjectionState>
  reconcile(input: Readonly<{ workflowId: string; runId: string }>): Promise<RunProjectionState>
}

const stableId = (prefix: string, ...parts: readonly string[]): string =>
  `${prefix}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24)}`

const requireRun = async (
  store: JournalCoordinatorStore,
  input: Readonly<{ workflowId: string; runId: string }>,
) => {
  const run = await store.load(input)
  if (run === undefined) throw new JournalCoordinatorError('RUN_NOT_FOUND', 'Run was not found')
  const workflow = WorkflowSchema.parse(run.workflow)
  const startNodeId = workflow.startNodeId
  if (workflow.workflowId !== input.workflowId || startNodeId === null) {
    throw new JournalCoordinatorError('WORKFLOW_NOT_RUNNABLE', 'Workflow is not runnable')
  }
  return { ...run, workflow, startNodeId }
}

const requireProjection = async (journal: RunJournal): Promise<RunProjectionState> => {
  const repaired = await journal.repairProjections()
  if (repaired.status === 'CORRUPT') {
    throw new JournalCoordinatorError('RUN_JOURNAL_CORRUPT', repaired.diagnostic.message)
  }
  return repaired.projection
}

const schedule = async (
  journal: RunJournal,
  input: Readonly<{
    runId: string
    nodeId: string
    executionIndex: number
    causationId: string
    timestamp: string
  }>,
): Promise<void> => {
  const nodeId = NodeIdSchema.parse(input.nodeId)
  const key = `${input.causationId}\0${nodeId}`
  await journal.append({
    eventId: stableId('event-schedule', key),
    timestamp: input.timestamp,
    type: 'NODE_SCHEDULED',
    data: {
      nodeExecutionId: stableId('node-execution', input.runId, key),
      attemptId: stableId('attempt', input.runId, key),
      nodeId,
      executionIndex: input.executionIndex,
      causationId: input.causationId,
    },
  })
}

const appendFailure = async (
  journal: RunJournal,
  causeId: string,
  code: string,
  timestamp: string,
): Promise<void> => {
  await journal.append({
    eventId: stableId('event-run-failed', causeId, code),
    timestamp,
    type: 'RUN_FAILED',
    data: { code },
  })
}

const lastReleaseSequence = (events: readonly RunDomainEvent[], targetNodeId: string): number =>
  events
    .filter((event) => event.type === 'JOIN_RELEASED' && event.data.targetNodeId === targetNodeId)
    .at(-1)?.sequence ?? 0

export const createJournalWorkflowCoordinator = (options: {
  readonly runs: JournalCoordinatorStore
  readonly workspaces?: Pick<FilesystemRunWorkspaceProvisioner, 'ensure'>
  readonly now?: () => string
}): JournalWorkflowCoordinator => {
  const now = options.now ?? (() => new Date().toISOString())
  const operationQueues = new Map<string, Promise<void>>()

  const serialize = <Value>(
    input: Readonly<{ workflowId: string; runId: string }>,
    operation: () => Promise<Value>,
  ): Promise<Value> => {
    const key = `${input.workflowId}\0${input.runId}`
    const previous = operationQueues.get(key) ?? Promise.resolve()
    const result = previous.then(operation)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    operationQueues.set(key, settled)
    void settled.then(() => {
      if (operationQueues.get(key) === settled) operationQueues.delete(key)
    })
    return result
  }

  const reconcileUnlocked = async (input: {
    readonly workflowId: string
    readonly runId: string
  }): Promise<RunProjectionState> => {
    const { journal, workflow, startNodeId } = await requireRun(options.runs, input)
    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      const replayed = await journal.replay()
      if (replayed.status === 'CORRUPT') {
        throw new JournalCoordinatorError('RUN_JOURNAL_CORRUPT', replayed.diagnostic.message)
      }
      const projection = await requireProjection(journal)
      if (projection.run.status !== 'PENDING' && projection.run.status !== 'RUNNING') {
        return projection
      }

      const cancellation = replayed.events.find(({ type }) => type === 'RUN_CANCEL_REQUESTED')
      if (cancellation?.type === 'RUN_CANCEL_REQUESTED') {
        const pending = projection.executions.find(({ status }) => status === 'PENDING')
        if (pending !== undefined) {
          await journal.append({
            eventId: stableId('event-node-cancelled', cancellation.eventId, pending.attemptId),
            timestamp: now(),
            type: 'NODE_CANCELLED',
            data: {
              nodeExecutionId: pending.nodeExecutionId,
              attemptId: pending.attemptId,
              reason: cancellation.data.reason,
              durationMs: 0,
            },
          })
          continue
        }
        if (projection.executions.some(({ status }) => status === 'RUNNING')) return projection
        await journal.append({
          eventId: stableId('event-run-cancelled', cancellation.eventId),
          timestamp: now(),
          type: 'RUN_CANCELLED',
          data: {},
        })
        continue
      }

      const started = replayed.events.find(({ type }) => type === 'RUN_STARTED')
      if (
        started !== undefined &&
        !replayed.events.some(
          (event) =>
            event.type === 'NODE_SCHEDULED' &&
            event.data.causationId === started.eventId &&
            event.data.nodeId === startNodeId,
        )
      ) {
        await schedule(journal, {
          runId: input.runId,
          nodeId: startNodeId,
          executionIndex: projection.executions.length,
          causationId: started.eventId,
          timestamp: now(),
        })
        continue
      }
      const unreconciledRelease = replayed.events.find(
        (event) =>
          event.type === 'JOIN_RELEASED' &&
          !replayed.events.some(
            (candidate) =>
              candidate.type === 'NODE_SCHEDULED' &&
              candidate.data.causationId === event.eventId &&
              candidate.data.nodeId === event.data.targetNodeId,
          ),
      )
      if (unreconciledRelease?.type === 'JOIN_RELEASED') {
        await schedule(journal, {
          runId: input.runId,
          nodeId: unreconciledRelease.data.targetNodeId,
          executionIndex: projection.executions.length,
          causationId: unreconciledRelease.eventId,
          timestamp: now(),
        })
        continue
      }

      const failed = replayed.events.find(({ type }) => type === 'NODE_FAILED')
      if (failed?.type === 'NODE_FAILED') {
        await appendFailure(journal, failed.eventId, failed.data.code, now())
        continue
      }
      const cancelled = replayed.events.find(({ type }) => type === 'NODE_CANCELLED')
      if (cancelled !== undefined) {
        await journal.append({
          eventId: stableId('event-run-cancelled', cancelled.eventId),
          timestamp: now(),
          type: 'RUN_CANCELLED',
          data: {},
        })
        continue
      }

      let changed = false
      for (const succeeded of replayed.events) {
        if (succeeded.type !== 'NODE_SUCCEEDED') continue
        const execution = projection.executions.find(
          ({ nodeExecutionId }) => nodeExecutionId === succeeded.data.nodeExecutionId,
        )
        if (execution === undefined) continue
        const candidates = workflow.edges.filter(
          ({ sourceNodeId }) => sourceNodeId === execution.nodeId,
        )
        if (candidates.length === 0) continue
        const outgoing = candidates.filter(({ outcome }) => outcome === succeeded.data.outcome)
        if (outgoing.length === 0) {
          await appendFailure(journal, succeeded.eventId, 'OUTCOME_NOT_ROUTABLE', now())
          changed = true
          break
        }
        const existingRoutes = replayed.events.filter(
          (event) =>
            event.type === 'ROUTE_TRAVERSED' &&
            event.data.sourceNodeExecutionId === execution.nodeExecutionId &&
            event.data.outcome === succeeded.data.outcome,
        )
        const missing = outgoing.filter(
          (edge) =>
            !existingRoutes.some(
              (event) =>
                event.type === 'ROUTE_TRAVERSED' && event.data.targetNodeId === edge.targetNodeId,
            ),
        )
        if (missing.length === 0) continue
        if (projection.run.transitionCount + missing.length > workflow.maxTransitions) {
          await appendFailure(journal, succeeded.eventId, 'TRANSITION_LIMIT_EXCEEDED', now())
          changed = true
          break
        }
        for (const edge of missing) {
          await journal.append({
            eventId: stableId('event-route', succeeded.eventId, edge.targetNodeId, edge.outcome),
            timestamp: now(),
            type: 'ROUTE_TRAVERSED',
            data: {
              sourceNodeExecutionId: execution.nodeExecutionId,
              sourceNodeId: execution.nodeId,
              targetNodeId: edge.targetNodeId,
              outcome: edge.outcome,
            },
          })
        }
        changed = true
        break
      }
      if (changed) continue

      for (const [targetNodeId, arrivals] of Object.entries(projection.routing.joinArrivals)) {
        const target = NodeIdSchema.parse(targetNodeId)
        const requiredSources = [
          ...new Set(
            workflow.edges
              .filter((edge) => edge.targetNodeId === targetNodeId)
              .map(({ sourceNodeId }) => sourceNodeId),
          ),
        ]
        if (!requiredSources.every((sourceNodeId) => arrivals.includes(sourceNodeId))) continue
        const afterSequence = lastReleaseSequence(replayed.events, targetNodeId)
        const arrivalEvents = replayed.events.filter(
          (event) =>
            event.sequence > afterSequence &&
            event.type === 'ROUTE_TRAVERSED' &&
            event.data.targetNodeId === targetNodeId,
        )
        const causation = arrivalEvents.at(-1)
        if (causation === undefined) continue
        const releaseId = stableId(
          'event-join-release',
          targetNodeId,
          ...arrivalEvents.map(({ eventId }) => eventId),
        )
        await journal.append({
          eventId: releaseId,
          timestamp: now(),
          type: 'JOIN_RELEASED',
          data: { targetNodeId: target, causationId: causation.eventId },
        })
        await schedule(journal, {
          runId: input.runId,
          nodeId: target,
          executionIndex: projection.executions.length,
          causationId: releaseId,
          timestamp: now(),
        })
        changed = true
        break
      }
      if (changed) continue

      if (
        projection.executions.length > 0 &&
        projection.executions.every(({ status }) => status === 'SUCCEEDED')
      ) {
        const cause = replayed.events.filter(({ type }) => type === 'NODE_SUCCEEDED').at(-1)
        if (cause !== undefined) {
          await journal.append({
            eventId: stableId('event-run-succeeded', cause.eventId),
            timestamp: now(),
            type: 'RUN_SUCCEEDED',
            data: {},
          })
          continue
        }
      }
      return projection
    }
    throw new JournalCoordinatorError(
      'JOURNAL_RECONCILE_LIMIT_EXCEEDED',
      'Run reconciliation exceeded its safety limit',
    )
  }

  return {
    start(input) {
      return serialize(input, async () => {
        const { journal, workflow, startNodeId } = await requireRun(options.runs, input)
        const initial = await requireProjection(journal)
        if (initial.run.status !== 'PENDING') return reconcileUnlocked(input)
        if (workflow.configuration.repositoryIds.length > 0) {
          let workspaceFailure = false
          try {
            if (options.workspaces === undefined)
              throw new Error('Workspace provisioner is missing')
            await options.workspaces.ensure(input)
            const prepared = await requireProjection(journal)
            const ready = new Set(
              prepared.workspaces.workspaces
                .filter(({ status }) => status === 'READY')
                .map(({ repositoryId }) => repositoryId),
            )
            workspaceFailure = workflow.configuration.repositoryIds.some(
              (repositoryId) => !ready.has(repositoryId),
            )
          } catch {
            workspaceFailure = true
          }
          if (workspaceFailure) {
            await appendFailure(
              journal,
              stableId('workspace-preparation', input.runId),
              'WORKSPACE_PREPARATION_FAILED',
              now(),
            )
            return requireProjection(journal)
          }
        }
        const replayed = await journal.replay()
        if (replayed.status === 'CORRUPT') {
          throw new JournalCoordinatorError('RUN_JOURNAL_CORRUPT', replayed.diagnostic.message)
        }
        const existing = replayed.events.find(({ type }) => type === 'RUN_STARTED')
        const timestamp = existing?.timestamp ?? now()
        const started =
          existing ??
          (await journal.append({
            eventId: 'run-started',
            timestamp,
            type: 'RUN_STARTED',
            data: {},
          }))
        await schedule(journal, {
          runId: input.runId,
          nodeId: startNodeId,
          executionIndex: 0,
          causationId: started.eventId,
          timestamp,
        })
        return reconcileUnlocked(input)
      })
    },
    requestCancellation(input) {
      return serialize(input, async () => {
        const { journal } = await requireRun(options.runs, input)
        const projection = await requireProjection(journal)
        if (projection.run.status === 'CANCELLED') return projection
        if (projection.run.status !== 'RUNNING') {
          throw new JournalCoordinatorError('RUN_NOT_CANCELLABLE', 'Run is not cancellable')
        }
        const replayed = await journal.replay()
        if (replayed.status === 'CORRUPT') {
          throw new JournalCoordinatorError('RUN_JOURNAL_CORRUPT', replayed.diagnostic.message)
        }
        if (!replayed.events.some(({ type }) => type === 'RUN_CANCEL_REQUESTED')) {
          await journal.append({
            eventId: stableId('event-cancel-request', input.runId),
            timestamp: now(),
            type: 'RUN_CANCEL_REQUESTED',
            data: { reason: input.reason },
          })
        }
        return reconcileUnlocked(input)
      })
    },
    reconcile(input) {
      return serialize(input, () => reconcileUnlocked(input))
    },
  }
}
