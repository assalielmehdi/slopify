import type { RunRecord, RunRepository } from '../persistence/run-repository.js'

export interface RecoveryService {
  reconcile(): RunRecord | undefined
}

export interface CreateRecoveryServiceOptions {
  readonly runs: RunRepository
  readonly now?: () => string
}

const duration = (startedAt: string | null, completedAt: string): number =>
  startedAt === null ? 0 : Math.max(0, Date.parse(completedAt) - Date.parse(startedAt))

export const createRecoveryService = (options: CreateRecoveryServiceOptions): RecoveryService => {
  const now = options.now ?? (() => new Date().toISOString())

  return {
    reconcile() {
      const run = options.runs.findActive()
      if (run?.status !== 'RUNNING') return undefined

      const completedAt = now()
      const node = options.runs
        .listNodeExecutions(run.runId)
        .find(({ status }) => status === 'RUNNING')
      if (node === undefined) {
        return options.runs.completeRun({
          runId: run.runId,
          expectedStatus: 'RUNNING',
          status: 'INTERRUPTED',
          durationMs: duration(run.startedAt, completedAt),
          timestamp: completedAt,
        })
      }

      return options.runs.failNodeAndRun({
        runId: run.runId,
        nodeExecutionId: node.nodeExecutionId,
        nodeId: node.nodeId,
        nodeStatus: 'FAILED',
        runStatus: 'INTERRUPTED',
        code: 'PROCESS_INTERRUPTED',
        message: 'Execution was interrupted by process restart',
        nodeDurationMs: duration(node.startedAt, completedAt),
        runDurationMs: duration(run.startedAt, completedAt),
        timestamp: completedAt,
      })
    },
  }
}
