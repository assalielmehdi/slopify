import { RunIdSchema, type RunEvent, type RunId } from '@slopify/contracts'

import type { EventStore } from '../events/event-store.js'
import type { SlopifyPaths } from '../filesystem/slopify-home.js'
import type { RunRepository } from '../persistence/run-repository.js'
import { createFilesystemRunJournal } from '../runs/filesystem-run-journal.js'
import type { FilesystemRunIndex } from '../runs/run-index.js'
import type { RunDomainEvent } from '../runs/run-events.js'

export class RunEventFeedError extends Error {
  override readonly name = 'RunEventFeedError'

  constructor(
    readonly code: 'RUN_NOT_FOUND' | 'RUN_EVENT_CURSOR_INVALID' | 'RUN_JOURNAL_CORRUPT',
    message: string,
  ) {
    super(message)
  }
}

export interface SubscribeToRunEventsInput {
  readonly runId: string
  readonly afterSequence?: number
  readonly signal?: AbortSignal
}

export interface RunEventFeed {
  subscribe(input: SubscribeToRunEventsInput): AsyncIterable<RunEvent>
}

export interface FilesystemRunEventFeed {
  subscribe(input: SubscribeToRunEventsInput): AsyncIterable<RunDomainEvent>
}

export interface CreateRunEventFeedOptions {
  readonly events: EventStore
  readonly runs: RunRepository
  readonly pageSize?: number
  readonly pollIntervalMs?: number
  readonly wait?: (signal: AbortSignal) => Promise<void>
}

const terminalStatuses = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED'])

const waitForPoll =
  (milliseconds: number) =>
  (signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return Promise.resolve()
    return new Promise((resolve) => {
      const onAbort = (): void => {
        clearTimeout(timeout)
        signal.removeEventListener('abort', onAbort)
        resolve()
      }
      const timeout = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, milliseconds)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }

export const createRunEventFeed = (options: CreateRunEventFeedOptions): RunEventFeed => {
  const pageSize = options.pageSize ?? 100
  const pollIntervalMs = options.pollIntervalMs ?? 100
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new RunEventFeedError('RUN_EVENT_CURSOR_INVALID', 'Event page size is invalid')
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 60_000) {
    throw new RunEventFeedError('RUN_EVENT_CURSOR_INVALID', 'Event poll interval is invalid')
  }
  const wait = options.wait ?? waitForPoll(pollIntervalMs)

  return {
    subscribe(input) {
      const runId: RunId = RunIdSchema.parse(input.runId)
      const afterSequence = input.afterSequence ?? 0
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        throw new RunEventFeedError('RUN_EVENT_CURSOR_INVALID', 'Run event cursor is invalid')
      }
      if (options.runs.get(runId) === undefined) {
        throw new RunEventFeedError('RUN_NOT_FOUND', 'Run was not found')
      }
      const signal = input.signal ?? new AbortController().signal

      return {
        async *[Symbol.asyncIterator]() {
          let cursor = afterSequence
          while (!signal.aborted) {
            const page = options.events.list({ runId, afterSequence: cursor, limit: pageSize })
            for (const event of page.events) {
              cursor = event.sequence
              yield event
              if (signal.aborted) return
            }
            if (page.nextAfterSequence !== null) continue

            const run = options.runs.get(runId)
            if (run === undefined) throw new RunEventFeedError('RUN_NOT_FOUND', 'Run was not found')
            if (terminalStatuses.has(run.status)) {
              const finalPage = options.events.list({
                runId,
                afterSequence: cursor,
                limit: pageSize,
              })
              if (finalPage.events.length === 0) return
              continue
            }
            await wait(signal)
          }
        },
      }
    },
  }
}

export interface CreateFilesystemRunEventFeedOptions {
  readonly index: Pick<FilesystemRunIndex, 'get'>
  readonly paths: Pick<SlopifyPaths, 'run'>
  readonly pageSize?: number
  readonly pollIntervalMs?: number
  readonly wait?: (signal: AbortSignal) => Promise<void>
}

const terminalEventTypes = new Set<RunDomainEvent['type']>([
  'RUN_SUCCEEDED',
  'RUN_FAILED',
  'RUN_CANCELLED',
])

export const createFilesystemRunEventFeed = (
  options: CreateFilesystemRunEventFeedOptions,
): FilesystemRunEventFeed => {
  const pageSize = options.pageSize ?? 100
  const pollIntervalMs = options.pollIntervalMs ?? 100
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new RunEventFeedError('RUN_EVENT_CURSOR_INVALID', 'Event page size is invalid')
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 60_000) {
    throw new RunEventFeedError('RUN_EVENT_CURSOR_INVALID', 'Event poll interval is invalid')
  }
  const wait = options.wait ?? waitForPoll(pollIntervalMs)

  return {
    subscribe(input) {
      const runId = RunIdSchema.parse(input.runId)
      const afterSequence = input.afterSequence ?? 0
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        throw new RunEventFeedError('RUN_EVENT_CURSOR_INVALID', 'Run event cursor is invalid')
      }
      const signal = input.signal ?? new AbortController().signal
      return {
        async *[Symbol.asyncIterator]() {
          const indexed = await options.index.get(runId)
          if (indexed === undefined)
            throw new RunEventFeedError('RUN_NOT_FOUND', 'Run was not found')
          if (indexed.status === 'CORRUPT') {
            throw new RunEventFeedError('RUN_JOURNAL_CORRUPT', 'Run artifacts are corrupt')
          }
          const journal = createFilesystemRunJournal({
            paths: options.paths,
            workflowId: indexed.locator.workflowId,
            runId,
          })
          let cursor = afterSequence
          while (!signal.aborted) {
            const replayed = await journal.replay()
            if (replayed.status === 'CORRUPT') {
              throw new RunEventFeedError('RUN_JOURNAL_CORRUPT', 'Run journal is corrupt')
            }
            const page = replayed.events
              .filter(({ sequence }) => sequence > cursor)
              .slice(0, pageSize)
            for (const event of page) {
              cursor = event.sequence
              yield event
              if (signal.aborted) return
            }
            if (replayed.events.some((event) => terminalEventTypes.has(event.type))) {
              if (!replayed.events.some(({ sequence }) => sequence > cursor)) return
              continue
            }
            if (page.length === pageSize) continue
            await wait(signal)
          }
        },
      }
    },
  }
}
