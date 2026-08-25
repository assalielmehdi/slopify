import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkflowFile } from '@slopify/workflow-model'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  calculateResourceRevision,
  createAtomicJsonResourceIO,
  createFilesystemRunIndex,
  createFilesystemRunReader,
  createFilesystemRunStore,
  resolveSlopifyPaths,
  type AtomicJsonResourceIO,
} from '../../src/index.js'

const timestamp = '2026-08-25T10:00:00.000Z'
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const workflow: WorkflowFile = {
  schemaVersion: 2,
  workflowId: 'history-review',
  name: 'History review',
  description: 'Exercise filesystem run history.',
  repositories: {
    repositoryIds: ['repository-api'],
    primaryRepositoryId: 'repository-api',
  },
  variables: ['release'],
  graph: {
    startNodeId: 'review',
    nodes: [
      {
        type: 'agent',
        id: 'review',
        name: 'Review',
        prompt: 'Review {{ release }}.',
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
  const home = mkdtempSync(join(tmpdir(), 'slopify-run-index-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  const resources = createAtomicJsonResourceIO()
  const reads = vi.fn(resources.read.bind(resources))
  const observedResources: AtomicJsonResourceIO = { ...resources, read: reads }
  const runs = createFilesystemRunStore({ paths, resources: observedResources })
  const admit = (runId: string, createdAt: string) =>
    runs.admit({
      runId,
      workflowId: workflow.workflowId,
      createdAt,
      workflowSnapshot: {
        schemaVersion: 1,
        capturedAt: createdAt,
        workflowRevision: calculateResourceRevision(`${runId}-workflow`),
        workflow,
      },
      variablesSnapshot: { schemaVersion: 1, values: { release: runId } },
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
  await admit('run-old', '2026-08-25T09:00:00.000Z')
  await admit('run-new', '2026-08-25T10:00:00.000Z')
  reads.mockClear()
  const index = createFilesystemRunIndex({ paths, resources: observedResources })
  return { index, paths, reads, resources: observedResources }
}

describe('filesystem run index and detail reader', () => {
  it('incrementally indexes runs with compatible ordering, filtering, and pagination', async () => {
    const fixture = await createFixture()

    await expect(fixture.index.list({ page: 1, pageSize: 1 })).resolves.toMatchObject({
      data: [{ status: 'READY', run: { runId: 'run-new' } }],
      pagination: { page: 1, pageSize: 1, totalItems: 2, totalPages: 2 },
    })
    const readsAfterFirstRefresh = fixture.reads.mock.calls.length
    await fixture.index.refresh()
    expect(fixture.reads).toHaveBeenCalledTimes(readsAfterFirstRefresh)

    await expect(
      fixture.index.list({ page: 1, pageSize: 20, runId: 'old', statuses: ['PENDING'] }),
    ).resolves.toMatchObject({ data: [{ status: 'READY', run: { runId: 'run-old' } }] })
    await expect(
      fixture.index.list({ page: 1, pageSize: 20, statuses: ['SUCCEEDED'] }),
    ).resolves.toMatchObject({ data: [] })
  })

  it('reads historical detail only from captured run artifacts', async () => {
    const fixture = await createFixture()
    const reader = createFilesystemRunReader({
      index: fixture.index,
      paths: fixture.paths,
      resources: fixture.resources,
    })

    await expect(reader.get('run-new')).resolves.toMatchObject({
      status: 'READY',
      run: { runId: 'run-new', workflowId: 'history-review' },
      workflowSnapshot: { workflow: { name: 'History review' } },
      variablesSnapshot: { values: { release: 'run-new' } },
      repositoriesSnapshot: {
        repositories: [{ repositoryId: 'repository-api', fullName: 'operator/api' }],
      },
      executions: [],
      events: [],
    })
    expect(fixture.paths.workflow('history-review').definitionFile).not.toBe(
      fixture.paths.run('history-review', 'run-new').workflowSnapshotFile,
    )
    expect(existsSync(fixture.paths.workflow('history-review').definitionFile)).toBe(false)
    expect(existsSync(fixture.paths.repositoriesFile)).toBe(false)
  })

  it('keeps corrupt run projections visible with a diagnostic', async () => {
    const fixture = await createFixture()
    writeFileSync(
      fixture.paths.run('history-review', 'run-old').runFile,
      '{"schemaVersion":1,"runId":"run-old"}\n',
    )

    await expect(fixture.index.list({ page: 1, pageSize: 20 })).resolves.toMatchObject({
      data: [
        { status: 'READY', run: { runId: 'run-new' } },
        {
          status: 'CORRUPT',
          locator: { workflowId: 'history-review', runId: 'run-old' },
          diagnostic: { code: 'RESOURCE_VALIDATION_FAILED' },
        },
      ],
      pagination: { totalItems: 2 },
    })
  })
})
