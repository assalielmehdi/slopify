import { RunIdSchema } from '@slopify/contracts'

import type { RunRecord, RunRepository } from '../persistence/run-repository.js'
import type { ExecutionWorker } from '../orchestration/execution-worker.js'
import type { WorkflowCoordinator } from '../orchestration/workflow-coordinator.js'

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

export const createCoordinatorCancellationService = (
  options: Readonly<{
    runs: Pick<RunRepository, 'get' | 'list'>
    coordinator: Pick<WorkflowCoordinator, 'cancel'>
    worker: Pick<ExecutionWorker, 'executingRunIds' | 'cancelRun'>
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
    if (options.worker.executingRunIds().includes(runId)) {
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
