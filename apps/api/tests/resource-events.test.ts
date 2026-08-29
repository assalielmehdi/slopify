import { describe, expect, it } from 'vitest'

import type { ResourceChangeEvent } from '@slopify/shared'
import { ResourceEventFeedError, type ResourceEventFeed } from '@slopify/execution-runtime'
import { createApiApp } from '../src/app.js'

const events: readonly ResourceChangeEvent[] = [
  {
    sequence: 1,
    timestamp: '2026-08-25T20:00:00.000Z',
    change: 'CHANGED',
    resource: { type: 'SETTINGS' },
    revision: 'a'.repeat(64),
  },
  {
    sequence: 2,
    timestamp: '2026-08-25T20:00:01.000Z',
    change: 'DELETED',
    resource: { type: 'WORKFLOW', workflowId: 'review-code' },
    revision: null,
  },
]

const finiteFeed = (): ResourceEventFeed => ({
  publish() {
    throw new Error('Not used by this test')
  },
  subscribe(input = {}) {
    const afterSequence = input.afterSequence ?? 0
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new ResourceEventFeedError(
        'RESOURCE_EVENT_CURSOR_INVALID',
        'Resource event cursor is invalid',
      )
    }
    return {
      async *[Symbol.asyncIterator]() {
        for (const event of events) if (event.sequence > afterSequence) yield event
      },
    }
  },
})

const eventIds = (body: string): number[] =>
  [...body.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]))

describe('editable resource SSE API', () => {
  it('streams stable resource events without local paths or credentials', async () => {
    const app = createApiApp({ resourceEvents: finiteFeed() })

    const response = await app.request('/api/resource-events')
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(eventIds(body)).toEqual([1, 2])
    expect(body).toContain('event: resource-change')
    expect(body).toContain('"workflowId":"review-code"')
    expect(body).not.toMatch(/path|token|credential/iu)
  })

  it('resumes after Last-Event-ID and rejects invalid cursors', async () => {
    const app = createApiApp({ resourceEvents: finiteFeed() })

    const resumed = await app.request('/api/resource-events', {
      headers: { 'Last-Event-ID': '1' },
    })
    const invalid = await app.request('/api/resource-events', {
      headers: { 'Last-Event-ID': '-1' },
    })

    expect(eventIds(await resumed.text())).toEqual([2])
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({
      error: { code: 'RESOURCE_EVENT_CURSOR_INVALID' },
    })
  })
})
