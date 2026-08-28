import { describe, expect, it } from 'vitest'

import { parseRunEvent, reconcileRunEvents, runEventStreamUrl } from '../lib/event-stream'
import { ApiRunEventSchema, type ApiRunEvent } from '../lib/run-api-contract'

const event = (sequence: number): ApiRunEvent =>
  ApiRunEventSchema.parse({
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    runId: 'run-01',
    sequence,
    timestamp: `2026-08-20T10:00:0${sequence}Z`,
    type: 'RUN_STARTED',
    data: {},
  })

describe('run event reconciliation', () => {
  it('deduplicates replayed events and retains one contiguous ordered sequence', () => {
    const result = reconcileRunEvents([event(1), event(2)], [event(2), event(3)])

    expect(result.requiresSnapshot).toBe(false)
    expect(result.events.map(({ sequence }) => sequence)).toEqual([1, 2, 3])
  })

  it('does not expose an event gap before a snapshot reconciles it', () => {
    const result = reconcileRunEvents([event(1)], [event(3)])

    expect(result.requiresSnapshot).toBe(true)
    expect(result.events.map(({ sequence }) => sequence)).toEqual([1])
  })

  it('validates SSE data and uses a cursor-free same-origin URL', () => {
    expect(parseRunEvent(JSON.stringify(event(1)))).toEqual(event(1))
    expect(() => parseRunEvent('{"sequence":2}')).toThrow()
    expect(runEventStreamUrl('run-01')).toBe('/api/runs/run-01/events')
    expect(() => runEventStreamUrl('../other')).toThrow()
  })

  it('validates filesystem journal events without rewriting their facts', () => {
    const filesystemEvent = {
      schemaVersion: 1,
      eventId: 'run-succeeded',
      runId: 'run-01',
      sequence: 3,
      timestamp: '2026-08-25T10:00:03Z',
      type: 'RUN_SUCCEEDED',
      data: {},
    } as const

    expect(parseRunEvent(JSON.stringify(filesystemEvent))).toEqual(filesystemEvent)
  })
})
