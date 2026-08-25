import { createHash } from 'node:crypto'

import { RepositoryIdSchema } from '@slopify/contracts'

import type { JournalCoordinatorStore } from '../orchestration/journal-coordinator-store.js'
import type {
  JournalExecutionWorker,
  JournalRunLocator,
} from '../orchestration/journal-execution-worker.js'
import type { JournalWorkflowCoordinator } from '../orchestration/journal-workflow-coordinator.js'
import type { RunWorkspaceProjection } from './run-artifacts.js'
import type { RunJournal } from './run-journal.js'
import type { RunProjectionState } from './run-projection.js'

export interface RunRecoveryStore extends JournalCoordinatorStore {
  list(): Promise<readonly JournalRunLocator[]>
}

export interface RunRecoveryWorkspaceCleaner {
  cleanup(input: {
    readonly run: JournalRunLocator
    readonly workspaces: readonly RunWorkspaceProjection[]
  }): Promise<readonly string[]>
}

export interface RunRecoverySummary {
  readonly scannedRuns: number
  readonly repairedProjections: number
  readonly resumedExecutions: number
  readonly interruptedExecutions: number
  readonly cleanedWorkspaces: number
}

export interface RunRecoveryService {
  recover(): Promise<RunRecoverySummary>
}

export type RunRecoveryErrorCode = 'RUN_JOURNAL_CORRUPT' | 'WORKSPACE_CLEANUP_INVALID'

export class RunRecoveryError extends Error {
  override readonly name = 'RunRecoveryError'

  constructor(
    readonly code: RunRecoveryErrorCode,
    message: string,
  ) {
    super(message)
  }
}

const terminal = (state: RunProjectionState): boolean =>
  state.run.status === 'SUCCEEDED' ||
  state.run.status === 'FAILED' ||
  state.run.status === 'CANCELLED'

const stableId = (prefix: string, ...parts: readonly string[]): string =>
  `${prefix}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24)}`

export const createRunRecoveryService = (options: {
  readonly runs: RunRecoveryStore
  readonly coordinator: Pick<JournalWorkflowCoordinator, 'reconcile' | 'start'>
  readonly worker: Pick<JournalExecutionWorker, 'drain'>
  readonly workspaces?: RunRecoveryWorkspaceCleaner
  readonly now?: () => string
}): RunRecoveryService => {
  const now = options.now ?? (() => new Date().toISOString())

  const requireProjection = async (
    journal: RunJournal,
  ): Promise<Readonly<{ state: RunProjectionState; repaired: boolean }>> => {
    const repaired = await journal.repairProjections()
    if (repaired.status === 'CORRUPT') {
      throw new RunRecoveryError('RUN_JOURNAL_CORRUPT', repaired.diagnostic.message)
    }
    return { state: repaired.projection, repaired: repaired.repaired }
  }

  const cleanup = async (
    locator: JournalRunLocator,
    journal: RunJournal,
    state: RunProjectionState,
  ): Promise<number> => {
    const pending = state.workspaces.workspaces.filter(({ status }) => status !== 'CLEANED')
    if (!terminal(state) || pending.length === 0 || options.workspaces === undefined) return 0
    const cleaned = await options.workspaces.cleanup({ run: locator, workspaces: pending })
    const expected = new Set(pending.map(({ repositoryId }) => repositoryId))
    const repositoryIds = [
      ...new Set(cleaned.map((repositoryId) => RepositoryIdSchema.parse(repositoryId))),
    ]
    if (repositoryIds.some((repositoryId) => !expected.has(repositoryId))) {
      throw new RunRecoveryError(
        'WORKSPACE_CLEANUP_INVALID',
        'Workspace cleanup returned an unexpected repository',
      )
    }
    for (const repositoryId of repositoryIds) {
      await journal.append({
        eventId: stableId('event-workspace-cleaned', locator.runId, repositoryId),
        timestamp: now(),
        type: 'WORKSPACE_CLEANED',
        data: { repositoryId },
      })
    }
    if (repositoryIds.length > 0) await requireProjection(journal)
    return repositoryIds.length
  }

  return {
    async recover() {
      const locators = await options.runs.list()
      const resumable: JournalRunLocator[] = []
      let repairedProjections = 0
      let interruptedExecutions = 0
      let cleanedWorkspaces = 0

      for (const locator of locators) {
        const run = await options.runs.load(locator)
        if (run === undefined) continue
        const repaired = await requireProjection(run.journal)
        if (repaired.repaired) repairedProjections += 1
        let state = repaired.state
        if (terminal(state)) {
          cleanedWorkspaces += await cleanup(locator, run.journal, state)
          continue
        }

        if (state.run.status === 'PENDING') {
          state = await options.coordinator.start(locator)
        } else {
          const interrupted = state.executions.filter(({ status }) => status === 'RUNNING')
          const failedAt = now()
          for (const execution of interrupted) {
            await run.journal.append({
              eventId: stableId('event-host-process-interrupted', execution.attemptId),
              timestamp: failedAt,
              type: 'NODE_FAILED',
              data: {
                nodeExecutionId: execution.nodeExecutionId,
                attemptId: execution.attemptId,
                code: 'HOST_PROCESS_INTERRUPTED',
                message: 'The Slopify host process stopped during node execution',
                durationMs:
                  execution.startedAt === null
                    ? 0
                    : Math.max(0, Date.parse(failedAt) - Date.parse(execution.startedAt)),
              },
            })
          }
          interruptedExecutions += interrupted.length
          state = await options.coordinator.reconcile(locator)
        }

        if (terminal(state)) {
          cleanedWorkspaces += await cleanup(locator, run.journal, state)
        } else {
          resumable.push(locator)
        }
      }

      const resumedExecutions = await options.worker.drain(resumable)
      for (const locator of resumable) {
        const run = await options.runs.load(locator)
        if (run === undefined) continue
        const repaired = await requireProjection(run.journal)
        if (repaired.repaired) repairedProjections += 1
        cleanedWorkspaces += await cleanup(locator, run.journal, repaired.state)
      }

      return {
        scannedRuns: locators.length,
        repairedProjections,
        resumedExecutions,
        interruptedExecutions,
        cleanedWorkspaces,
      }
    },
  }
}
