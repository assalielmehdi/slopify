import { afterEach, describe, expect, it } from 'vitest'

import { RunEventFeedError, createRunEventFeed } from '../../src/index.js'
import { appendEvent } from '../../src/events/event-store.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'
import { TEST_RUN_ID, createPersistenceFixture, createRun } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const terminalize = (fixture: ReturnType<typeof createPersistenceFixture>): void => {
  const connection = getDatabaseHandle(fixture.database)
  connection
    .transaction(() => {
      connection
        .prepare(
          `UPDATE runs
           SET status = 'SUCCEEDED', started_at = ?, completed_at = ?
           WHERE run_id = ? AND status = 'PENDING'`,
        )
        .run('2026-08-18T23:30:00Z', '2026-08-18T23:30:02Z', TEST_RUN_ID)
      appendEvent(connection, TEST_RUN_ID, {
        type: 'RUN_STATUS_CHANGED',
        data: { from: 'PENDING', to: 'SUCCEEDED' },
        timestamp: '2026-08-18T23:30:02Z',
      })
      appendEvent(connection, TEST_RUN_ID, {
        type: 'RUN_COMPLETED',
        data: { status: 'SUCCEEDED', durationMs: 2_000 },
        timestamp: '2026-08-18T23:30:02Z',
      })
    })
    .immediate()
}

describe('run event feed', () => {
  it('replays persisted events, observes a terminal transition after waiting, and closes', async () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)
    let waits = 0
    const feed = createRunEventFeed({
      events: fixture.events,
      runs: fixture.runs,
      wait: async () => {
        waits += 1
        terminalize(fixture)
      },
    })

    const received = []
    for await (const event of feed.subscribe({ runId: TEST_RUN_ID })) received.push(event)

    expect(received.map(({ sequence }) => sequence)).toEqual([1, 2, 3])
    expect(received.map(({ type }) => type)).toEqual([
      'RUN_STARTED',
      'RUN_STATUS_CHANGED',
      'RUN_COMPLETED',
    ])
    expect(waits).toBe(1)
  })

  it('resumes strictly after the acknowledged sequence without duplicates', async () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)
    terminalize(fixture)
    const feed = createRunEventFeed({ events: fixture.events, runs: fixture.runs })

    const received = []
    for await (const event of feed.subscribe({ runId: TEST_RUN_ID, afterSequence: 1 })) {
      received.push(event)
    }

    expect(received.map(({ sequence }) => sequence)).toEqual([2, 3])
  })

  it('stops a pending subscription promptly when the client aborts', async () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)
    let waitObservedAbort = false
    const feed = createRunEventFeed({
      events: fixture.events,
      runs: fixture.runs,
      wait: (signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              waitObservedAbort = true
              resolve()
            },
            { once: true },
          )
        }),
    })
    const controller = new AbortController()
    const iterator = feed
      .subscribe({ runId: TEST_RUN_ID, signal: controller.signal })
      [Symbol.asyncIterator]()

    expect((await iterator.next()).value).toMatchObject({ sequence: 1 })
    const pending = iterator.next()
    controller.abort()

    await expect(pending).resolves.toEqual({ done: true, value: undefined })
    expect(waitObservedAbort).toBe(true)
  })

  it('rejects an unknown run before opening a subscription', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const feed = createRunEventFeed({ events: fixture.events, runs: fixture.runs })

    expect(() => feed.subscribe({ runId: TEST_RUN_ID })).toThrowError(
      expect.objectContaining({ code: 'RUN_NOT_FOUND' }) as RunEventFeedError,
    )
  })
})
