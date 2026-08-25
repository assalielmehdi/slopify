import { describe, expect, it, vi } from 'vitest'

import { RunEventSchema, type RunEvent } from '@slopify/contracts'

import { createApiClient } from '../lib/api-client'
import { parseRunEvent, reconcileRunEvents, runEventStreamUrl } from '../lib/event-stream'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const event = (sequence: number, type: RunEvent['type'] = 'NODE_STARTED'): RunEvent =>
  RunEventSchema.parse(
    type === 'RUN_STARTED'
      ? {
          runId: 'run-01',
          sequence,
          timestamp: `2026-08-20T10:00:0${sequence}Z`,
          type,
          data: {
            workflowId: 'default-workflow',
          },
        }
      : {
          runId: 'run-01',
          sequence,
          timestamp: `2026-08-20T10:00:0${sequence}Z`,
          type,
          nodeId: 'implementation',
          data: {},
        },
  )

const workflow = createAgentWorkflowFixture({
  createdAt: '2026-08-20T10:00:00Z',
  modelId: 'test-model',
  thinkingLevel: 'high',
})

const run = {
  runId: 'run-01',
  workflowId: workflow.workflowId,
  workflowSnapshot: workflow,
  variables: { task: 'Follow a live run' },
  status: 'RUNNING',
  transitionCount: 1,
  createdAt: '2026-08-20T10:00:00Z',
  startedAt: '2026-08-20T10:00:01Z',
  completedAt: null,
} as const

const detail = {
  run,
  repositories: [],
  repositoryWorkspaces: [],
  events: [event(1, 'RUN_STARTED'), event(2)],
  nodeExecutions: [],
}

describe('run event reconciliation', () => {
  it('deduplicates replayed events and retains one contiguous ordered sequence', () => {
    const result = reconcileRunEvents([event(1, 'RUN_STARTED'), event(2)], [event(2), event(3)])

    expect(result.requiresSnapshot).toBe(false)
    expect(result.events.map(({ sequence }) => sequence)).toEqual([1, 2, 3])
  })

  it('does not expose an event gap before a snapshot reconciles it', () => {
    const result = reconcileRunEvents([event(1, 'RUN_STARTED')], [event(3)])

    expect(result.requiresSnapshot).toBe(true)
    expect(result.events.map(({ sequence }) => sequence)).toEqual([1])
  })

  it('validates SSE data and uses a cursor-free same-origin URL', () => {
    expect(parseRunEvent(JSON.stringify(event(1, 'RUN_STARTED')))).toEqual(event(1, 'RUN_STARTED'))
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

describe('live run API contract', () => {
  it('loads the exact captured run detail and validates every evidence collection', async () => {
    const fetchImplementation = vi.fn(async () => Response.json(detail))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.getRun('run-01')).resolves.toEqual(detail)
    expect(fetchImplementation).toHaveBeenCalledWith('/api/runs/run-01', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
  })

  it('cancels without an optimistic status and trusts only the confirmed run response', async () => {
    const cancelledRun = {
      ...run,
      status: 'CANCELLED',
      completedAt: '2026-08-20T10:00:09Z',
    } as const
    const fetchImplementation = vi.fn(async () => Response.json(cancelledRun))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(
      client.cancelRun('run-01', { reason: 'Operator stopped the run' }),
    ).resolves.toEqual(cancelledRun)
    expect(fetchImplementation).toHaveBeenCalledWith('/api/runs/run-01/cancel', {
      body: JSON.stringify({ reason: 'Operator stopped the run' }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    })
  })
})
