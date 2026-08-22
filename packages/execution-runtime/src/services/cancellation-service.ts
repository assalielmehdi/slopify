import { RunIdSchema, type NodeId, type RunId } from '@slopify/contracts'

import type { RunRecord, RunRepository } from '../persistence/run-repository.js'
import type { ExecutionWorker } from '../orchestration/execution-worker.js'
import type { WorkflowCoordinator } from '../orchestration/workflow-coordinator.js'

export type ActiveRunCancellationResult =
  Readonly<{ status: 'cancelled' }> | Readonly<{ status: 'unconfirmed' }>

export interface ActiveRunExecution {
  readonly runId: RunId
  readonly nodeExecutionId: string
  readonly nodeId: NodeId
  cancel(input: Readonly<{ reason?: string }>): Promise<ActiveRunCancellationResult>
}

export type CancellationServiceErrorCode = 'RUN_NOT_CANCELLABLE' | 'RUN_NOT_FOUND'

export class CancellationServiceError extends Error {
  override readonly name = 'CancellationServiceError'

  constructor(
    readonly code: CancellationServiceErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface CancellationService {
  cancel(input: Readonly<{ runId: string; reason?: string }>): Promise<RunRecord>
  cancelActive(reason?: string): Promise<RunRecord | undefined>
}

export interface CreateCancellationServiceOptions {
  readonly runs: RunRepository
  readonly activeExecution: () => ActiveRunExecution | undefined
  readonly now?: () => string
}

const duration = (startedAt: string | null, completedAt: string): number =>
  startedAt === null ? 0 : Math.max(0, Date.parse(completedAt) - Date.parse(startedAt))

export const createCancellationService = (
  options: CreateCancellationServiceOptions,
): CancellationService => {
  const now = options.now ?? (() => new Date().toISOString())
  const inFlight = new Map<RunId, Promise<RunRecord>>()

  const cancel = async (
    input: Readonly<{ runId: string; reason?: string }>,
  ): Promise<RunRecord> => {
    const runId = RunIdSchema.parse(input.runId)
    const pending = inFlight.get(runId)
    if (pending !== undefined) return pending

    const operation = (async () => {
      const run = options.runs.get(runId)
      if (run === undefined) {
        throw new CancellationServiceError('RUN_NOT_FOUND', 'Run was not found')
      }
      const execution = options.activeExecution()
      const node = options.runs.listNodeExecutions(runId).find(({ status }) => status === 'RUNNING')
      if (
        run.status !== 'RUNNING' ||
        execution?.runId !== runId ||
        node?.nodeExecutionId !== execution.nodeExecutionId ||
        node.nodeId !== execution.nodeId
      ) {
        throw new CancellationServiceError(
          'RUN_NOT_CANCELLABLE',
          'Run is not the active cancellable execution',
        )
      }

      options.runs.requestCancellation({
        runId,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        timestamp: now(),
      })

      let result: ActiveRunCancellationResult = { status: 'unconfirmed' }
      try {
        result = await execution.cancel(input.reason === undefined ? {} : { reason: input.reason })
      } catch {
        // A thrown cancellation attempt provides no proof that execution stopped.
      }

      const completedAt = now()
      const confirmed = result.status === 'cancelled'
      return options.runs.failNodeAndRun({
        runId,
        nodeExecutionId: execution.nodeExecutionId,
        nodeId: execution.nodeId,
        nodeStatus: confirmed ? 'CANCELLED' : 'FAILED',
        runStatus: confirmed ? 'CANCELLED' : 'FAILED',
        code: confirmed ? 'EXECUTOR_CANCELLED' : 'CANCELLATION_UNCONFIRMED',
        message: confirmed
          ? (input.reason ?? 'Active execution confirmed cancellation')
          : 'Active execution could not confirm cancellation',
        nodeDurationMs: duration(node.startedAt, completedAt),
        runDurationMs: duration(run.startedAt, completedAt),
        timestamp: completedAt,
      })
    })()

    inFlight.set(runId, operation)
    try {
      return await operation
    } finally {
      inFlight.delete(runId)
    }
  }

  return {
    cancel,
    async cancelActive(reason) {
      const execution = options.activeExecution()
      if (execution === undefined) return undefined
      return cancel({ runId: execution.runId, ...(reason === undefined ? {} : { reason }) })
    },
  }
}

export const createCoordinatorCancellationService = (
  options: Readonly<{
    runs: Pick<RunRepository, 'get' | 'list'>
    coordinator: Pick<WorkflowCoordinator, 'cancel'>
    worker: Pick<ExecutionWorker, 'activeRunIds' | 'cancelRun'>
  }>,
): CancellationService => {
  const cancel = async (
    input: Readonly<{ runId: string; reason?: string }>,
  ): Promise<RunRecord> => {
    const runId = RunIdSchema.parse(input.runId)
    const run = options.runs.get(runId)
    if (run === undefined) throw new CancellationServiceError('RUN_NOT_FOUND', 'Run was not found')
    if (run.status !== 'RUNNING')
      throw new CancellationServiceError('RUN_NOT_CANCELLABLE', 'Run is not cancellable')
    if (options.worker.activeRunIds().includes(runId)) {
      const result = await options.worker.cancelRun(runId)
      if (result.status !== 'cancelled')
        throw new CancellationServiceError(
          'RUN_NOT_CANCELLABLE',
          'Active execution could not confirm cancellation',
        )
    }
    options.coordinator.cancel(runId, input.reason ?? 'Cancellation requested')
    const cancelled = options.runs.get(runId)
    if (cancelled === undefined)
      throw new CancellationServiceError('RUN_NOT_FOUND', 'Run was not found')
    return cancelled
  }

  return {
    cancel,
    async cancelActive(reason) {
      const activeRuns: RunRecord[] = []
      let page = 1
      while (true) {
        const result = options.runs.list({ page, pageSize: 100 })
        activeRuns.push(...result.data.filter(({ status }) => status === 'RUNNING'))
        if (page >= result.pagination.totalPages) break
        page += 1
      }
      let last: RunRecord | undefined
      for (const run of activeRuns)
        last = await cancel({ runId: run.runId, ...(reason === undefined ? {} : { reason }) })
      return last
    },
  }
}
