import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkflowFile } from '@slopify/workflow-model'
import { afterEach, describe, expect, it } from 'vitest'

import {
  calculateResourceRevision,
  createFilesystemRunEventFeed,
  createFilesystemRunIndex,
  createFilesystemRunJournal,
  createFilesystemRunStore,
  createRunEventFeed,
  resolveSlopifyPaths,
  RunEventFeedError,
  type FilesystemRunEventFeed,
} from '@slopify/execution-runtime'
import { appendEvent } from '../../../packages/execution-runtime/src/events/event-store.js'
import { getDatabaseHandle } from '../../../packages/execution-runtime/src/persistence/database.js'
import {
  TEST_RUN_ID,
  createPersistenceFixture,
  createRun,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'
import { startApiServer } from '../src/server.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []
const directories: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const terminalFixture = () => {
  const fixture = createPersistenceFixture()
  fixtures.push(fixture)
  createRun(fixture)
  const connection = getDatabaseHandle(fixture.database)
  connection
    .transaction(() => {
      connection
        .prepare(
          `UPDATE runs
           SET status = 'SUCCEEDED', started_at = ?, completed_at = ?
           WHERE run_id = ? AND status = 'PENDING'`,
        )
        .run('2026-08-18T23:45:00Z', '2026-08-18T23:45:02Z', TEST_RUN_ID)
      appendEvent(connection, TEST_RUN_ID, {
        type: 'RUN_STATUS_CHANGED',
        data: { from: 'PENDING', to: 'SUCCEEDED' },
        timestamp: '2026-08-18T23:45:02Z',
      })
      appendEvent(connection, TEST_RUN_ID, {
        type: 'RUN_COMPLETED',
        data: { status: 'SUCCEEDED', durationMs: 2_000 },
        timestamp: '2026-08-18T23:45:02Z',
      })
    })
    .immediate()
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
        tracesRoot: '/traces',
        workspacesRoot: '/workspaces',
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

const filesystemWorkflow: WorkflowFile = {
  schemaVersion: 2,
  workflowId: 'event-review',
  name: 'Event review',
  description: 'Exercise the filesystem event API.',
  repositories: {
    repositoryIds: ['repository-api'],
    primaryRepositoryId: 'repository-api',
  },
  variables: [],
  graph: {
    startNodeId: 'review',
    nodes: [
      {
        type: 'agent',
        id: 'review',
        name: 'Review',
        prompt: 'Review.',
        harness: { harnessId: 'pi' },
      },
    ],
    edges: [],
    maxTransitions: 0,
  },
  createdAt: '2026-08-25T10:00:00.000Z',
  updatedAt: '2026-08-25T10:00:00.000Z',
}

const filesystemEventFixture = async () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-api-filesystem-events-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  await createFilesystemRunStore({ paths }).admit({
    runId: 'run-filesystem-events',
    workflowId: filesystemWorkflow.workflowId,
    createdAt: filesystemWorkflow.createdAt,
    workflowSnapshot: {
      schemaVersion: 1,
      capturedAt: filesystemWorkflow.createdAt,
      workflowRevision: calculateResourceRevision('filesystem event workflow'),
      workflow: filesystemWorkflow,
    },
    variablesSnapshot: { schemaVersion: 1, values: {} },
    repositoriesSnapshot: {
      schemaVersion: 1,
      repositories: [
        {
          repositoryId: 'repository-api',
          position: 0,
          name: 'API',
          provider: 'GITHUB',
          remoteId: '123',
          fullName: 'operator/api',
          cloneUrl: 'https://github.com/operator/api.git',
          webUrl: 'https://github.com/operator/api',
          defaultBranch: 'main',
          baseSha: 'a'.repeat(40),
          isPrimary: true,
        },
      ],
    },
    verifySource: async () => undefined,
  })
  const journal = createFilesystemRunJournal({
    paths,
    workflowId: filesystemWorkflow.workflowId,
    runId: 'run-filesystem-events',
  })
  await journal.append({
    eventId: 'run-started',
    timestamp: filesystemWorkflow.createdAt,
    type: 'RUN_STARTED',
    data: {},
  })
  await journal.append({
    eventId: 'run-succeeded',
    timestamp: '2026-08-25T10:00:01.000Z',
    type: 'RUN_SUCCEEDED',
    data: {},
  })
  return createApiApp({
    eventFeed: createFilesystemRunEventFeed({
      index: createFilesystemRunIndex({ paths }),
      paths,
    }),
  })
}

describe('filesystem run event SSE API', () => {
  it('resumes journal facts after Last-Event-ID and preserves journal sequence IDs', async () => {
    const app = await filesystemEventFixture()

    const response = await app.request('/api/runs/run-filesystem-events/events', {
      headers: { 'Last-Event-ID': '1' },
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(eventIds(body)).toEqual([2])
    expect(body).toContain('"type":"RUN_SUCCEEDED"')
  })

  it('reports corrupt journal state as a resource conflict', async () => {
    const eventFeed = {
      subscribe() {
        throw new RunEventFeedError('RUN_JOURNAL_CORRUPT', 'Run journal is corrupt')
      },
    } satisfies FilesystemRunEventFeed

    const response = await createApiApp({ eventFeed }).request('/api/runs/run-corrupt/events')

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: { code: 'RUN_JOURNAL_CORRUPT', message: 'Run journal is corrupt' },
    })
  })
})
