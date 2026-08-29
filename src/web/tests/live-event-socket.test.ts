// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectLiveEventSocket } from '../lib/live-event-socket'

class FakeWebSocket {
  static readonly instances: FakeWebSocket[] = []
  static readonly OPEN = 1

  readonly url: string
  readyState = FakeWebSocket.OPEN
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()

  constructor(url: string | URL) {
    this.url = String(url)
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  close(): void {
    this.readyState = 3
  }

  emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('live event WebSocket', () => {
  it('validates event envelopes and reconnects from the caller current cursor', () => {
    let cursor = 1
    const handlers = {
      onDisconnect: vi.fn(),
      onEvent: vi.fn(),
      onInvalidEvent: vi.fn(),
      onOpen: vi.fn(),
    }
    const close = connectLiveEventSocket(
      () => `ws://127.0.0.1:7311/live?afterSequence=${cursor}`,
      handlers,
    )
    const first = FakeWebSocket.instances[0]
    if (first === undefined) throw new Error('Expected the first WebSocket')

    first.emit('open', new Event('open'))
    first.emit(
      'message',
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'EVENT', event: { sequence: 2 } }),
      }),
    )
    expect(handlers.onOpen).toHaveBeenCalledOnce()
    expect(handlers.onEvent).toHaveBeenCalledWith({ sequence: 2 })

    cursor = 2
    first.emit('close', new CloseEvent('close'))
    expect(handlers.onDisconnect).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(250)
    expect(FakeWebSocket.instances[1]?.url).toBe('ws://127.0.0.1:7311/live?afterSequence=2')

    close()
    expect(FakeWebSocket.instances[1]?.readyState).toBe(3)
  })

  it('reports typed server errors and malformed envelopes', () => {
    const handlers = {
      onDisconnect: vi.fn(),
      onEvent: vi.fn(),
      onInvalidEvent: vi.fn(),
      onOpen: vi.fn(),
    }
    connectLiveEventSocket(() => 'ws://127.0.0.1:7311/live', handlers)
    const socket = FakeWebSocket.instances[0]
    if (socket === undefined) throw new Error('Expected a WebSocket')

    socket.emit(
      'message',
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'ERROR',
          error: { code: 'TRACE_NOT_FOUND', message: 'Trace was not found' },
        }),
      }),
    )
    socket.emit('message', new MessageEvent('message', { data: '{"type":"EVENT"}' }))

    expect(handlers.onInvalidEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: 'Trace was not found' }),
    )
    expect(handlers.onInvalidEvent).toHaveBeenCalledTimes(2)
    expect(handlers.onEvent).not.toHaveBeenCalled()
  })
})
