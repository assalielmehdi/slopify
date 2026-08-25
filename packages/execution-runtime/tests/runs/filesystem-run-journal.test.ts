import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkflowFile } from '@slopify/workflow-model'
import { afterEach, describe, expect, it } from 'vitest'

import {
  calculateResourceRevision,
  createFilesystemRunJournal,
  createFilesystemRunStore,
  resolveNodeExecutionPaths,
  resolveSlopifyPaths,
  type RunJournalError,
} from '../../src/index.js'

const directories: string[] = []
const timestamp = '2026-08-25T10:00:00.000Z'

const workflow: WorkflowFile = {
  schemaVersion: 2,
  workflowId: 'release-review',
  name: 'Release review',
  description: 'Review a release.',
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
        prompt: 'Review the release.',
        harness: { harnessId: 'pi' },
      },
    ],
    edges: [],
    maxTransitions: 0,
  },
  createdAt: timestamp,
  updatedAt: timestamp,
}

const createFixture = async () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-run-journal-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  await createFilesystemRunStore({ paths }).admit({
    runId: 'run-01',
    workflowId: 'release-review',
    createdAt: timestamp,
    workflowSnapshot: {
      schemaVersion: 1,
      capturedAt: timestamp,
      workflowRevision: calculateResourceRevision('workflow source'),
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
  return {
    paths,
    runPaths: paths.run('release-review', 'run-01'),
    journal: createFilesystemRunJournal({ paths, workflowId: 'release-review', runId: 'run-01' }),
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('filesystem run journal', () => {
  it('serializes concurrent facts and treats event IDs as idempotency keys', async () => {
    const { journal, paths } = await createFixture()
    const secondJournal = createFilesystemRunJournal({
      paths,
      workflowId: 'release-review',
      runId: 'run-01',
    })

    const appended = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 === 0 ? journal : secondJournal).append({
          eventId: `cancel-request-${index}`,
          timestamp,
          type: 'RUN_CANCEL_REQUESTED',
          data: { reason: `Request ${index}` },
        }),
      ),
    )
    expect(appended.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    )

    const repeated = await journal.append({
      eventId: 'cancel-request-0',
      timestamp,
      type: 'RUN_CANCEL_REQUESTED',
      data: { reason: 'Request 0' },
    })
    expect(repeated.sequence).toBe(1)
    await expect(
      journal.append({
        eventId: 'cancel-request-0',
        timestamp,
        type: 'RUN_CANCEL_REQUESTED',
        data: { reason: 'Conflicting request' },
      }),
    ).rejects.toMatchObject({ code: 'RUN_EVENT_CONFLICT' } satisfies Partial<RunJournalError>)

    await expect(journal.replay()).resolves.toMatchObject({
      status: 'READY',
      events: appended,
    })
  })

  it('rebuilds stale run, workspace, and node projections from authoritative facts', async () => {
    const { journal, runPaths } = await createFixture()
    await journal.append({ eventId: 'run-started', timestamp, type: 'RUN_STARTED', data: {} })
    await journal.append({
      eventId: 'workspace-preparing',
      timestamp,
      type: 'WORKSPACE_PREPARING',
      data: {
        repositoryId: 'repository-api',
        position: 0,
        workspacePath: join(runPaths.workspacesDirectory, 'repository-api'),
        branchName: 'slopify/run-01',
      },
    })
    await journal.append({
      eventId: 'workspace-ready',
      timestamp,
      type: 'WORKSPACE_READY',
      data: { repositoryId: 'repository-api' },
    })
    await journal.append({
      eventId: 'node-scheduled',
      timestamp,
      type: 'NODE_SCHEDULED',
      data: {
        nodeExecutionId: 'node-execution-review',
        attemptId: 'attempt-review',
        nodeId: 'review',
        executionIndex: 0,
        causationId: 'run-started',
      },
    })
    await journal.append({
      eventId: 'node-started',
      timestamp,
      type: 'NODE_STARTED',
      data: { nodeExecutionId: 'node-execution-review', attemptId: 'attempt-review' },
    })

    const repaired = await journal.repairProjections()

    expect(repaired).toMatchObject({ status: 'READY', repaired: true })
    expect(JSON.parse(readFileSync(runPaths.runFile, 'utf8'))).toMatchObject({
      status: 'RUNNING',
      lastEventSequence: 5,
    })
    expect(JSON.parse(readFileSync(runPaths.workspacesFile, 'utf8'))).toMatchObject({
      lastEventSequence: 5,
      workspaces: [expect.objectContaining({ status: 'READY' })],
    })
    const nodePaths = resolveNodeExecutionPaths(runPaths, 0, 'node-execution-review')
    expect(JSON.parse(readFileSync(nodePaths.executionFile, 'utf8'))).toMatchObject({
      status: 'RUNNING',
      lastEventSequence: 5,
    })
    await expect(journal.repairProjections()).resolves.toMatchObject({
      status: 'READY',
      repaired: false,
    })
  })

  it('returns a typed corrupt status without rewriting a malformed complete record', async () => {
    const { journal, runPaths } = await createFixture()
    const source = '{"schemaVersion":1,"sequence":1,"broken":true}\n'
    writeFileSync(runPaths.eventsFile, source)

    await expect(journal.replay()).resolves.toMatchObject({
      status: 'CORRUPT',
      diagnostic: { code: 'JSONL_CORRUPT', lineNumber: 1 },
    })
    await expect(journal.repairProjections()).resolves.toMatchObject({
      status: 'CORRUPT',
      diagnostic: { code: 'JSONL_CORRUPT', lineNumber: 1 },
    })
    expect(readFileSync(runPaths.eventsFile, 'utf8')).toBe(source)
  })

  it('surfaces semantically invalid facts as inspectable corruption', async () => {
    const { journal } = await createFixture()
    await journal.append({ eventId: 'run-started', timestamp, type: 'RUN_STARTED', data: {} })
    await journal.append({
      eventId: 'orphan-start',
      timestamp,
      type: 'NODE_STARTED',
      data: { nodeExecutionId: 'missing-execution', attemptId: 'missing-attempt' },
    })

    await expect(journal.repairProjections()).resolves.toMatchObject({
      status: 'CORRUPT',
      diagnostic: { code: 'EVENT_SEMANTICS_INVALID', lineNumber: 2 },
    })
  })
})
