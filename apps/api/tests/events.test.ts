import { afterEach, describe, expect, it } from 'vitest'

import { createRunEventFeed } from '@loop/execution-runtime'
import {
  TEST_RUN_ID,
  createPersistenceFixture,
  createRun,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'
import { startApiServer } from '../src/server.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const terminalFixture = () => {
  const fixture = createPersistenceFixture()
  fixtures.push(fixture)
  createRun(fixture)
  fixture.runs.completeRun({
    runId: TEST_RUN_ID,
    expectedStatus: 'PENDING',
    status: 'SUCCEEDED',
    durationMs: 2_000,
    timestamp: '2026-08-18T23:45:02Z',
  })
  return {
    fixture,
    app: createApiApp({
      database: fixture.database,
      eventFeed: createRunEventFeed({ events: fixture.events, runs: fixture.runs }),
    }),
  }
}

const eventIds = (body: string): number[] =>
  [...body.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]))

describe('run event SSE API', () => {
  it('replays every ordered persisted event and closes after a terminal run', async () => {
    const { app } = terminalFixture()

    const response = await app.request(`/api/runs/${TEST_RUN_ID}/events`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(eventIds(body)).toEqual([1, 2, 3])
    expect(body).toContain('event: run-event')
    expect(body).toContain('"type":"RUN_COMPLETED"')
  })

  it('resumes after Last-Event-ID without replaying acknowledged events', async () => {
    const { app } = terminalFixture()

    const response = await app.request(`/api/runs/${TEST_RUN_ID}/events`, {
      headers: { 'Last-Event-ID': '1' },
    })

    expect(eventIds(await response.text())).toEqual([2, 3])
  })

  it('rejects ambiguous or invalid cursors before opening the stream', async () => {
    const { app } = terminalFixture()

    const ambiguous = await app.request(`/api/runs/${TEST_RUN_ID}/events?afterSequence=2`, {
      headers: { 'Last-Event-ID': '1' },
    })
    const invalid = await app.request(`/api/runs/${TEST_RUN_ID}/events?afterSequence=-1`)

    expect(ambiguous.status).toBe(400)
    expect(await ambiguous.json()).toMatchObject({
      error: { code: 'RUN_EVENT_CURSOR_INVALID' },
    })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({
      error: { code: 'RUN_EVENT_CURSOR_INVALID' },
    })
  })

  it('aborts the live feed when the HTTP reader disconnects', async () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)
    let observeAbort: (() => void) | undefined
    const aborted = new Promise<void>((resolve) => {
      observeAbort = resolve
    })
    const eventFeed = createRunEventFeed({
      events: fixture.events,
      runs: fixture.runs,
      wait: (signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              observeAbort?.()
              resolve()
            },
            { once: true },
          )
        }),
    })
    const server = startApiServer({
      app: createApiApp({ database: fixture.database, eventFeed }),
      configuration: {
        hostname: '127.0.0.1',
        port: 0,
        databasePath: '/unused-in-this-test.sqlite',
        workspaceRoot: '/workspace',
        shutdownGracePeriodMs: 10_000,
      },
    })
    const request = new AbortController()

    try {
      const response = await fetch(
        `http://${server.hostname}:${server.port}/api/runs/${TEST_RUN_ID}/events`,
        { signal: request.signal },
      )
      const reader = response.body?.getReader()
      expect(reader).toBeDefined()
      expect(new TextDecoder().decode((await reader?.read())?.value)).toContain('id: 1')

      request.abort()

      await expect(aborted).resolves.toBeUndefined()
    } finally {
      request.abort()
      await server.stop(true)
    }
  })
})
