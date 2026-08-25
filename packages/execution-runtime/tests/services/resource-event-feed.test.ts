import { describe, expect, it } from 'vitest'

import { createResourceEventFeed } from '../../src/index.js'

const settingsChange = {
  change: 'CHANGED' as const,
  resource: { type: 'SETTINGS' as const },
  revision: 'a'.repeat(64),
}

describe('editable resource event feed', () => {
  it('assigns stable sequences and replays only events after the cursor', async () => {
    const feed = createResourceEventFeed({
      now: () => new Date('2026-08-25T20:00:00.000Z'),
      wait: async (signal) => signal.throwIfAborted(),
    })
    feed.publish(settingsChange)
    feed.publish({
      change: 'CREATED',
      resource: { type: 'WORKFLOW', workflowId: 'review-code' },
      revision: 'b'.repeat(64),
    })
    const controller = new AbortController()
    const iterator = feed
      .subscribe({ afterSequence: 1, signal: controller.signal })
      [Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        sequence: 2,
        timestamp: '2026-08-25T20:00:00.000Z',
        change: 'CREATED',
        resource: { type: 'WORKFLOW', workflowId: 'review-code' },
        revision: 'b'.repeat(64),
      },
    })
    controller.abort()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('keeps bounded replay while preserving the monotonic cursor', async () => {
    const feed = createResourceEventFeed({ maxEvents: 2 })
    feed.publish(settingsChange)
    feed.publish({ ...settingsChange, revision: 'b'.repeat(64) })
    feed.publish({ ...settingsChange, revision: 'c'.repeat(64) })
    const controller = new AbortController()
    const iterator = feed
      .subscribe({ afterSequence: 0, signal: controller.signal })
      [Symbol.asyncIterator]()

    expect((await iterator.next()).value?.sequence).toBe(2)
    expect((await iterator.next()).value?.sequence).toBe(3)
    controller.abort()
  })

  it('stops a pending subscription when the client aborts', async () => {
    const feed = createResourceEventFeed({ pollIntervalMs: 60_000 })
    const controller = new AbortController()
    const iterator = feed.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
    const pending = iterator.next()

    controller.abort()

    await expect(pending).resolves.toEqual({ done: true, value: undefined })
  })

  it('rejects invalid cursors before opening the subscription', () => {
    const feed = createResourceEventFeed()

    expect(() => feed.subscribe({ afterSequence: -1 })).toThrow('Resource event cursor is invalid')
  })
})
