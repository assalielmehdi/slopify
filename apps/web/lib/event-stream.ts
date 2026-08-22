import { RunEventSchema, RunIdSchema, type RunEvent } from '@slopify/contracts'

export interface EventReconciliation {
  readonly events: readonly RunEvent[]
  readonly requiresSnapshot: boolean
}

export interface RunEventConnectionHandlers {
  readonly onDisconnect: () => void
  readonly onEvent: (event: RunEvent) => void
  readonly onInvalidEvent: (cause: unknown) => void
  readonly onOpen: () => void
}

export type RunEventConnector = (url: string, handlers: RunEventConnectionHandlers) => () => void

const sameEvent = (left: RunEvent, right: RunEvent): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export function reconcileRunEvents(
  current: readonly RunEvent[],
  incoming: readonly RunEvent[],
): EventReconciliation {
  const bySequence = new Map<number, RunEvent>()
  let runId: string | undefined
  let requiresSnapshot = false

  for (const candidate of [...current, ...incoming]) {
    if (runId !== undefined && candidate.runId !== runId) {
      throw new Error('Run event streams cannot contain multiple run IDs')
    }
    runId = candidate.runId

    const existing = bySequence.get(candidate.sequence)
    if (existing !== undefined && !sameEvent(existing, candidate)) {
      requiresSnapshot = true
      continue
    }
    bySequence.set(candidate.sequence, candidate)
  }

  const ordered = [...bySequence.values()].sort((left, right) => left.sequence - right.sequence)
  const contiguous: RunEvent[] = []
  for (const candidate of ordered) {
    if (candidate.sequence !== contiguous.length + 1) {
      requiresSnapshot = true
      break
    }
    contiguous.push(candidate)
  }

  return { events: contiguous, requiresSnapshot }
}

export const parseRunEvent = (data: string): RunEvent => RunEventSchema.parse(JSON.parse(data))

export const runEventStreamUrl = (runId: string): string =>
  `/api/runs/${encodeURIComponent(RunIdSchema.parse(runId))}/events`

export const connectRunEventStream: RunEventConnector = (url, handlers) => {
  const source = new EventSource(url)
  source.addEventListener('open', handlers.onOpen)
  source.addEventListener('error', handlers.onDisconnect)
  source.addEventListener('run-event', (message) => {
    try {
      if (!(message instanceof MessageEvent) || typeof message.data !== 'string') {
        throw new Error('Run event data is invalid')
      }
      handlers.onEvent(parseRunEvent(message.data))
    } catch (cause) {
      handlers.onInvalidEvent(cause)
    }
  })
  return () => source.close()
}
