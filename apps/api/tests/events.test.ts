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
  resolveSlopifyPaths,
  RunEventFeedError,
  type FilesystemRunEventFeed,
} from '@slopify/execution-runtime'
import { createApiApp } from '../src/app.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const eventIds = (body: string): number[] =>
  [...body.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]))

const filesystemWorkflow: WorkflowFile = {
  schemaVersion: 3,
  workflowId: 'event-review',
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
        timeoutSeconds: 900,
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
