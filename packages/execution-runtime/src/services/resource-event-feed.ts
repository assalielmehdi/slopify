import { ResourceChangeEventSchema, type ResourceChangeEvent } from '@slopify/contracts'

export class ResourceEventFeedError extends Error {
  override readonly name = 'ResourceEventFeedError'

  constructor(
    readonly code: 'RESOURCE_EVENT_CURSOR_INVALID',
    message: string,
  ) {
    super(message)
  }
}

export type PublishResourceChangeInput = Omit<ResourceChangeEvent, 'sequence' | 'timestamp'>

export interface SubscribeToResourceEventsInput {
  readonly afterSequence?: number
  readonly signal?: AbortSignal
}

export interface ResourceEventFeed {
  publish(input: PublishResourceChangeInput): ResourceChangeEvent
  subscribe(input?: SubscribeToResourceEventsInput): AsyncIterable<ResourceChangeEvent>
}

export interface CreateResourceEventFeedOptions {
  readonly maxEvents?: number
  readonly pollIntervalMs?: number
  readonly now?: () => Date
  readonly wait?: (signal: AbortSignal) => Promise<void>
}

const positiveInteger = (name: string, value: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} must be an integer from 1 to ${maximum}`)
  }
  return value
}

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

export const createResourceEventFeed = (
  options: CreateResourceEventFeedOptions = {},
): ResourceEventFeed => {
  const maxEvents = positiveInteger('maxEvents', options.maxEvents ?? 256, 10_000)
  const pollIntervalMs = positiveInteger('pollIntervalMs', options.pollIntervalMs ?? 100, 60_000)
  const now = options.now ?? (() => new Date())
  const wait = options.wait ?? waitForPoll(pollIntervalMs)
  const events: ResourceChangeEvent[] = []
  let nextSequence = 1

  return {
    publish(input) {
      const event = ResourceChangeEventSchema.parse({
        ...input,
        sequence: nextSequence,
        timestamp: now().toISOString(),
      })
      nextSequence += 1
      events.push(event)
      if (events.length > maxEvents) events.splice(0, events.length - maxEvents)
      return event
    },
    subscribe(input = {}) {
      const afterSequence = input.afterSequence ?? 0
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        throw new ResourceEventFeedError(
          'RESOURCE_EVENT_CURSOR_INVALID',
          'Resource event cursor is invalid',
        )
      }
      const signal = input.signal ?? new AbortController().signal

      return {
        async *[Symbol.asyncIterator]() {
          let cursor = afterSequence
          while (!signal.aborted) {
            const available = events.filter(({ sequence }) => sequence > cursor)
            for (const event of available) {
              cursor = event.sequence
              yield event
              if (signal.aborted) return
            }
            await wait(signal)
          }
        },
      }
    },
  }
}
