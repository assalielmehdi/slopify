import { describe, expect, it, vi } from 'vitest'

import {
  connectResourceEventStream,
  parseResourceChangeEvent,
  resourceEventStreamUrl,
  type ResourceEventSource,
} from '../lib/resource-event-stream'

class FakeEventSource extends EventTarget implements ResourceEventSource {
  readonly close = vi.fn()
}

const event = {
  sequence: 1,
  timestamp: '2026-08-25T20:00:00.000Z',
  change: 'CHANGED' as const,
  resource: { type: 'WORKFLOW' as const, workflowId: 'review-code' },
  revision: 'a'.repeat(64),
}

describe('editable resource event stream', () => {
  it('validates credential-free events from the same-origin stream', () => {
    expect(resourceEventStreamUrl).toBe('/api/resource-events')
    expect(parseResourceChangeEvent(JSON.stringify(event))).toEqual(event)
    expect(() =>
      parseResourceChangeEvent(JSON.stringify({ ...event, path: '/Users/me' })),
    ).toThrow()
    expect(() => parseResourceChangeEvent(JSON.stringify({ ...event, token: 'secret' }))).toThrow()
  })

  it('reconciles on reconnect and periodically while forwarding valid events', async () => {
    vi.useFakeTimers()
    const source = new FakeEventSource()
    const handlers = {
      onDisconnect: vi.fn(),
      onEvent: vi.fn(),
      onInvalidEvent: vi.fn(),
      onOpen: vi.fn(),
      onReconcile: vi.fn(async () => undefined),
    }
    const disconnect = connectResourceEventStream(handlers, {
      createEventSource: vi.fn((url) => {
        expect(url).toBe(resourceEventStreamUrl)
        return source
      }),
      reconcileIntervalMs: 5_000,
    })

    source.dispatchEvent(new Event('open'))
    source.dispatchEvent(new MessageEvent('resource-change', { data: JSON.stringify(event) }))
    await vi.advanceTimersByTimeAsync(10_000)

    expect(handlers.onOpen).toHaveBeenCalledOnce()
    expect(handlers.onEvent).toHaveBeenCalledWith(event)
    expect(handlers.onReconcile).toHaveBeenCalledTimes(3)
    expect(handlers.onInvalidEvent).not.toHaveBeenCalled()

    disconnect()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(source.close).toHaveBeenCalledOnce()
    expect(handlers.onReconcile).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('reports disconnects, invalid payloads, and failed reconciliation', async () => {
    const source = new FakeEventSource()
    const reconciliationError = new Error('reconciliation failed')
    const handlers = {
      onDisconnect: vi.fn(),
      onEvent: vi.fn(),
      onInvalidEvent: vi.fn(),
      onOpen: vi.fn(),
      onReconcile: vi.fn(async () => Promise.reject(reconciliationError)),
    }
    const disconnect = connectResourceEventStream(handlers, {
      createEventSource: () => source,
      reconcileIntervalMs: 60_000,
    })

    source.dispatchEvent(new Event('error'))
    source.dispatchEvent(new MessageEvent('resource-change', { data: '{"sequence":1}' }))
    source.dispatchEvent(new Event('open'))
    await vi.waitFor(() => expect(handlers.onInvalidEvent).toHaveBeenCalledTimes(2))

    expect(handlers.onDisconnect).toHaveBeenCalledOnce()
    expect(handlers.onEvent).not.toHaveBeenCalled()
    expect(handlers.onInvalidEvent).toHaveBeenCalledWith(reconciliationError)
    disconnect()
  })
})
