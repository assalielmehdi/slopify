import { describe, expect, it } from 'vitest'

import { parseRunEvent, reconcileRunEvents, runLiveEventUrl } from '../lib/event-stream'
import { agentTraceLiveEventUrl } from '../lib/agent-trace-stream'
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

  it('validates event data and builds a cursor-resumable WebSocket URL', () => {
    expect(parseRunEvent(event(1))).toEqual(event(1))
    expect(() => parseRunEvent({ sequence: 2 })).toThrow()
    expect(runLiveEventUrl('http://127.0.0.1:7311', 'run-01', 3)).toBe(
      'ws://127.0.0.1:7311/api/runs/run-01/live?afterSequence=3',
    )
    expect(runLiveEventUrl('https://slopify.test', 'run-01', 0)).toBe(
      'wss://slopify.test/api/runs/run-01/live?afterSequence=0',
    )
    expect(
      agentTraceLiveEventUrl(
        'http://127.0.0.1:7311',
        'run-01',
        'node-execution-01',
        'attempt-01',
        7,
      ),
    ).toBe(
      'ws://127.0.0.1:7311/api/runs/run-01/node-executions/node-execution-01/trace/live?attemptId=attempt-01&afterSequence=7',
    )
    expect(() => runLiveEventUrl('http://127.0.0.1:7311', '../other', 0)).toThrow()
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

    expect(parseRunEvent(filesystemEvent)).toEqual(filesystemEvent)
  })
})
