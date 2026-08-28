import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkflowFile } from '@slopify/workflow-model'
import { afterEach, describe, expect, it } from 'vitest'

import {
  RunEventFeedError,
  calculateResourceRevision,
  createFilesystemRunEventFeed,
  createFilesystemRunIndex,
  createFilesystemRunJournal,
  createFilesystemRunStore,
  resolveSlopifyPaths,
} from '../../src/index.js'

const timestamp = '2026-08-25T10:00:00.000Z'
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const workflow: WorkflowFile = {
  schemaVersion: 3,
  workflowId: 'feed-review',
  description: 'Exercise journal cursors.',
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
  createdAt: timestamp,
  updatedAt: timestamp,
}

const createFixture = async () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-filesystem-run-feed-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  await createFilesystemRunStore({ paths }).admit({
    runId: 'run-01',
    workflowId: workflow.workflowId,
    createdAt: timestamp,
    workflowSnapshot: {
      schemaVersion: 1,
      capturedAt: timestamp,
      workflowRevision: calculateResourceRevision('feed workflow'),
      workflow,
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
    workflowId: workflow.workflowId,
    runId: 'run-01',
    paths,
  })
  await journal.append({ eventId: 'run-started', timestamp, type: 'RUN_STARTED', data: {} })
  return { journal, paths }
}

describe('filesystem run event feed', () => {
  it('tails journal facts, closes on terminal state, and resumes strictly after a cursor', async () => {
    const fixture = await createFixture()
    let waits = 0
    const feed = createFilesystemRunEventFeed({
      index: createFilesystemRunIndex({ paths: fixture.paths }),
      paths: fixture.paths,
      wait: async () => {
        waits += 1
        await fixture.journal.append({
          eventId: 'run-succeeded',
          timestamp,
          type: 'RUN_SUCCEEDED',
          data: {},
        })
      },
    })
    const events = []
    for await (const event of feed.subscribe({ runId: 'run-01' })) events.push(event)

    expect(events.map(({ sequence, type }) => ({ sequence, type }))).toEqual([
      { sequence: 1, type: 'RUN_STARTED' },
      { sequence: 2, type: 'RUN_SUCCEEDED' },
    ])
    expect(waits).toBe(1)
    const resumed = []
    for await (const event of feed.subscribe({ runId: 'run-01', afterSequence: 1 })) {
      resumed.push(event)
    }
    expect(resumed.map(({ sequence }) => sequence)).toEqual([2])
  })

  it('rejects invalid cursors and unknown runs', async () => {
    const fixture = await createFixture()
    const feed = createFilesystemRunEventFeed({
      index: createFilesystemRunIndex({ paths: fixture.paths }),
      paths: fixture.paths,
    })

    expect(() => feed.subscribe({ runId: 'run-01', afterSequence: -1 })).toThrowError(
      expect.objectContaining({ code: 'RUN_EVENT_CURSOR_INVALID' }) as RunEventFeedError,
    )
    const iterator = feed.subscribe({ runId: 'missing-run' })[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' })
  })
})
