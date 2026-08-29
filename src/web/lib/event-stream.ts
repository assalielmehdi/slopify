import { RunIdSchema } from '@slopify/shared'

import type { LiveEventSubscription } from '@/lib/live-event-socket'
import { webSocketUrl } from '@/lib/live-event-socket'
import { ApiRunEventSchema, type ApiRunEvent } from '@/lib/run-api-contract'

export type RunEvent = ApiRunEvent

export interface EventReconciliation {
  readonly events: readonly RunEvent[]
  readonly requiresSnapshot: boolean
}

export type RunEventSubscription = LiveEventSubscription

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

export const parseRunEvent = (data: unknown): RunEvent => ApiRunEventSchema.parse(data)

export const runLiveEventUrl = (origin: string, runId: string, afterSequence: number): string =>
  webSocketUrl(origin, `/api/runs/${encodeURIComponent(RunIdSchema.parse(runId))}/live`, {
    afterSequence,
  })
