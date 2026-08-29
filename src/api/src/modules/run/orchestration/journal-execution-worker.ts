import { createHash } from 'node:crypto'
import { z } from 'zod'

import type { RunDomainEvent } from '../runs/run-events.js'
import type { RunJournal } from '../runs/run-journal.js'
import type { JournalCoordinatorStore } from './journal-coordinator-store.js'
import type { JournalWorkflowCoordinator } from './journal-workflow-coordinator.js'
import type { NodeRunInput, NodeRunResult, NodeRunner } from './node-runner.js'
import {
  createScheduledNodeClaims,
  type ScheduledNodeClaim,
  type ScheduledNodeClaims,
} from './scheduled-node-claims.js'

export interface JournalRunLocator {
  readonly workflowId: string
  readonly runId: string
}

export interface JournalExecutionWorker {
  runOnce(runs: readonly JournalRunLocator[]): Promise<boolean>
  drain(runs: readonly JournalRunLocator[]): Promise<number>
  cancelRun(
    run: JournalRunLocator,
    reason: string,
  ): Promise<Readonly<{ status: 'cancelled' | 'unconfirmed' }>>
  executingRunIds(): readonly string[]
}

export type JournalExecutionWorkerErrorCode = 'RUN_JOURNAL_CORRUPT'

export class JournalExecutionWorkerError extends Error {
  override readonly name = 'JournalExecutionWorkerError'

  constructor(
    readonly code: JournalExecutionWorkerErrorCode,
    message: string,
  ) {
    super(message)
  }
}

const validConcurrency = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 32) {
    throw new TypeError('Worker concurrency is invalid')
  }
  return value
}

const stableId = (prefix: string, ...parts: readonly string[]): string =>
  `${prefix}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24)}`

const terminalEvent = (event: RunDomainEvent): boolean =>
  event.type === 'NODE_SUCCEEDED' || event.type === 'NODE_FAILED' || event.type === 'NODE_CANCELLED'

const eventAttemptId = (event: RunDomainEvent): string | undefined => {
  if (
    event.type === 'NODE_STARTED' ||
    event.type === 'NODE_SUCCEEDED' ||
    event.type === 'NODE_FAILED' ||
    event.type === 'NODE_CANCELLED'
  ) {
    return event.data.attemptId
  }
  return undefined
}

interface ClaimedExecution {
  readonly claim: ScheduledNodeClaim
  readonly input: NodeRunInput
  readonly journal: RunJournal
  readonly locator: JournalRunLocator
}

export const createJournalExecutionWorker = (options: {
  readonly runs: JournalCoordinatorStore
  readonly coordinator: Pick<JournalWorkflowCoordinator, 'reconcile'>
  readonly runner: NodeRunner
  readonly concurrency?: number
  readonly claims?: ScheduledNodeClaims
  readonly now?: () => string
}): JournalExecutionWorker => {
  const concurrency = validConcurrency(options.concurrency ?? 2)
  const claims = options.claims ?? createScheduledNodeClaims(concurrency)
  const now = options.now ?? (() => new Date().toISOString())
  const active = new Map<string, ClaimedExecution>()
  const terminalWrites = new Map<string, Promise<void>>()

  const serializeTerminal = async (key: string, operation: () => Promise<void>): Promise<void> => {
    const previous = terminalWrites.get(key) ?? Promise.resolve()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => gate)
    terminalWrites.set(key, queued)
    await previous
    try {
      await operation()
    } finally {
      release()
      if (terminalWrites.get(key) === queued) terminalWrites.delete(key)
    }
  }

  const claimNext = async (
    locators: readonly JournalRunLocator[],
  ): Promise<ClaimedExecution | undefined> => {
    for (const locator of locators) {
      const run = await options.runs.load(locator)
      if (run === undefined) continue
      const replayed = await run.journal.replay()
      if (replayed.status === 'CORRUPT') {
        throw new JournalExecutionWorkerError('RUN_JOURNAL_CORRUPT', replayed.diagnostic.message)
      }
      if (replayed.events.some(({ type }) => type === 'RUN_CANCEL_REQUESTED')) continue
      for (const event of replayed.events) {
        if (event.type !== 'NODE_SCHEDULED') continue
        if (
          replayed.events.some(
            (candidate) =>
              eventAttemptId(candidate) === event.data.attemptId &&
              (candidate.type === 'NODE_STARTED' || terminalEvent(candidate)),
          )
        ) {
          continue
        }
        const key = `${locator.runId}\0${event.data.attemptId}`
        const claim = claims.tryClaim(key)
        if (claim === undefined) continue
        const execution = {
          claim,
          locator,
          journal: run.journal,
          input: {
            runId: locator.runId,
            nodeExecutionId: event.data.nodeExecutionId,
            attemptId: event.data.attemptId,
            nodeId: event.data.nodeId,
          },
        }
        active.set(key, execution)
        return execution
      }
    }
    return undefined
  }

  const publishTerminal = async (
    execution: ClaimedExecution,
    result: NodeRunResult,
    startedAt: string,
  ): Promise<void> => {
    const replayed = await execution.journal.replay()
    if (replayed.status === 'CORRUPT') {
      throw new JournalExecutionWorkerError('RUN_JOURNAL_CORRUPT', replayed.diagnostic.message)
    }
    if (
      replayed.events.some(
        (event) => terminalEvent(event) && eventAttemptId(event) === execution.input.attemptId,
      )
    ) {
      return
    }
    const completedAt = now()
    const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt))
    const eventKey = `${execution.locator.runId}\0${execution.input.attemptId}`
    if (result.status === 'succeeded') {
      const output = z.json().safeParse(result.output)
      if (!output.success) {
        await execution.journal.append({
          eventId: stableId('event-node-failed', eventKey),
          timestamp: completedAt,
          type: 'NODE_FAILED',
          data: {
            nodeExecutionId: execution.input.nodeExecutionId,
            attemptId: execution.input.attemptId,
            code: 'NODE_RESULT_INVALID',
            message: 'Node runner produced an invalid result',
            durationMs,
          },
        })
        return
      }
      await execution.journal.append({
        eventId: stableId('event-node-succeeded', eventKey),
        timestamp: completedAt,
        type: 'NODE_SUCCEEDED',
        data: {
          nodeExecutionId: execution.input.nodeExecutionId,
          attemptId: execution.input.attemptId,
          outcome: result.outcome,
          output: output.data,
          durationMs,
        },
      })
    } else if (result.status === 'cancelled') {
      await execution.journal.append({
        eventId: stableId('event-node-cancelled', eventKey),
        timestamp: completedAt,
        type: 'NODE_CANCELLED',
        data: {
          nodeExecutionId: execution.input.nodeExecutionId,
          attemptId: execution.input.attemptId,
          reason: result.reason,
          durationMs,
        },
      })
    } else {
      await execution.journal.append({
        eventId: stableId('event-node-failed', eventKey),
        timestamp: completedAt,
        type: 'NODE_FAILED',
        data: {
          nodeExecutionId: execution.input.nodeExecutionId,
          attemptId: execution.input.attemptId,
          code: result.code,
          message: result.message,
          durationMs,
        },
      })
    }
  }

  const runOnce = async (runs: readonly JournalRunLocator[]): Promise<boolean> => {
    const execution = await claimNext(runs)
    if (execution === undefined) return false
    const key = `${execution.locator.runId}\0${execution.input.attemptId}`
    const startedAt = now()
    try {
      await execution.journal.append({
        eventId: stableId('event-node-started', key),
        timestamp: startedAt,
        type: 'NODE_STARTED',
        data: {
          nodeExecutionId: execution.input.nodeExecutionId,
          attemptId: execution.input.attemptId,
        },
      })
      let result: NodeRunResult
      try {
        result = await options.runner.run(execution.input)
      } catch {
        result = {
          status: 'failed',
          code: 'NODE_RUNNER_FAILED',
          message: 'Node runner failed before producing a result',
        }
      }
      await serializeTerminal(key, () => publishTerminal(execution, result, startedAt))
      await options.coordinator.reconcile(execution.locator)
      return true
    } finally {
      active.delete(key)
      execution.claim.release()
    }
  }

  const cancelRun = async (
    locator: JournalRunLocator,
    reason: string,
  ): Promise<Readonly<{ status: 'cancelled' | 'unconfirmed' }>> => {
    const run = await options.runs.load(locator)
    if (run === undefined) return { status: 'unconfirmed' }
    const replayed = await run.journal.replay()
    if (replayed.status === 'CORRUPT') {
      throw new JournalExecutionWorkerError('RUN_JOURNAL_CORRUPT', replayed.diagnostic.message)
    }
    const terminalAttemptIds = new Set(
      replayed.events.filter(terminalEvent).flatMap((event) => {
        const attemptId = eventAttemptId(event)
        return attemptId === undefined ? [] : [attemptId]
      }),
    )
    const started = replayed.events.filter(
      (event): event is Extract<RunDomainEvent, { readonly type: 'NODE_STARTED' }> =>
        event.type === 'NODE_STARTED' && !terminalAttemptIds.has(event.data.attemptId),
    )
    if (started.length === 0) return { status: 'cancelled' }
    let confirmed = true
    for (const event of started) {
      const key = `${locator.runId}\0${event.data.attemptId}`
      const execution = active.get(key)
      let status: 'cancelled' | 'unconfirmed' = 'unconfirmed'
      if (execution !== undefined) {
        try {
          status = (await options.runner.cancel(execution.input)).status
        } catch {
          status = 'unconfirmed'
        }
      }
      if (status === 'cancelled') {
        await serializeTerminal(key, async () => {
          const current = await run.journal.replay()
          if (current.status === 'CORRUPT') {
            throw new JournalExecutionWorkerError('RUN_JOURNAL_CORRUPT', current.diagnostic.message)
          }
          if (
            current.events.some(
              (candidate) =>
                terminalEvent(candidate) && eventAttemptId(candidate) === event.data.attemptId,
            )
          ) {
            return
          }
          const completedAt = now()
          await run.journal.append({
            eventId: stableId('event-node-cancelled', key),
            timestamp: completedAt,
            type: 'NODE_CANCELLED',
            data: {
              nodeExecutionId: event.data.nodeExecutionId,
              attemptId: event.data.attemptId,
              reason,
              durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(event.timestamp)),
            },
          })
        })
      } else {
        confirmed = false
        await serializeTerminal(key, async () => {
          const current = await run.journal.replay()
          if (current.status === 'CORRUPT') {
            throw new JournalExecutionWorkerError('RUN_JOURNAL_CORRUPT', current.diagnostic.message)
          }
          if (
            current.events.some(
              (candidate) =>
                candidate.type === 'NODE_TERMINATION_UNCONFIRMED' &&
                candidate.data.attemptId === event.data.attemptId,
            )
          ) {
            return
          }
          await run.journal.append({
            eventId: stableId('event-node-termination-unconfirmed', key),
            timestamp: now(),
            type: 'NODE_TERMINATION_UNCONFIRMED',
            data: {
              nodeExecutionId: event.data.nodeExecutionId,
              attemptId: event.data.attemptId,
              reason,
            },
          })
        })
      }
    }
    return confirmed ? { status: 'cancelled' } : { status: 'unconfirmed' }
  }

  return {
    runOnce,
    async drain(runs) {
      let processed = 0
      while (true) {
        const batch = await Promise.all(Array.from({ length: concurrency }, () => runOnce(runs)))
        const count = batch.filter(Boolean).length
        processed += count
        if (count === 0) return processed
      }
    },
    cancelRun,
    executingRunIds() {
      return [...new Set([...active.values()].map(({ locator }) => locator.runId))]
    },
  }
}
