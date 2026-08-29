import type { RunProjectionState } from '../runs/run-projection.js'
import type {
  JournalExecutionWorker,
  JournalRunLocator,
} from '../orchestration/journal-execution-worker.js'
import type { JournalWorkflowCoordinator } from '../orchestration/journal-workflow-coordinator.js'

export type JournalCancellationServiceErrorCode = 'PROCESS_TERMINATION_UNCONFIRMED'

export class JournalCancellationServiceError extends Error {
  override readonly name = 'JournalCancellationServiceError'

  constructor(
    readonly code: JournalCancellationServiceErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface JournalCancellationService {
  cancel(input: JournalRunLocator & Readonly<{ reason?: string }>): Promise<RunProjectionState>
}

export const createJournalCancellationService = (options: {
  readonly coordinator: Pick<JournalWorkflowCoordinator, 'reconcile' | 'requestCancellation'>
  readonly worker: Pick<JournalExecutionWorker, 'cancelRun'>
}): JournalCancellationService => ({
  async cancel(input) {
    const reason = input.reason ?? 'Cancellation requested'
    const locator = { workflowId: input.workflowId, runId: input.runId }
    let projection = await options.coordinator.requestCancellation({ ...locator, reason })
    if (projection.run.status === 'CANCELLED') return projection
    const termination = await options.worker.cancelRun(locator, reason)
    if (termination.status === 'unconfirmed') {
      throw new JournalCancellationServiceError(
        'PROCESS_TERMINATION_UNCONFIRMED',
        'Active execution could not confirm cancellation',
      )
    }
    projection = await options.coordinator.reconcile(locator)
    return projection
  },
})
