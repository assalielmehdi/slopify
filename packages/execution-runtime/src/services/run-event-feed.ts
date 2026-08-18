import { RunIdSchema, type RunEvent, type RunId } from '@loop/contracts'

import type { EventStore } from '../events/event-store.js'
import type { RunRepository } from '../persistence/run-repository.js'

export class RunEventFeedError extends Error {
  override readonly name = 'RunEventFeedError'

  constructor(
    readonly code: 'RUN_NOT_FOUND' | 'RUN_EVENT_CURSOR_INVALID',
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

export interface CreateRunEventFeedOptions {
  readonly events: EventStore
  readonly runs: RunRepository
  readonly pageSize?: number
  readonly pollIntervalMs?: number
  readonly wait?: (signal: AbortSignal) => Promise<void>
}

const terminalStatuses = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'])

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
