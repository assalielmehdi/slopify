import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkflowFile } from '@slopify/shared'
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
  schemaVersion: 3,
  workflowId: 'history-review',
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

const deployWorkflow: WorkflowFile = {
  ...workflow,
  workflowId: 'deploy-review',
  repositories: {
    repositoryIds: ['repository-web'],
    primaryRepositoryId: 'repository-web',
  },
}

const writeRunProjection = (
  paths: ReturnType<typeof resolveSlopifyPaths>,
  input: Readonly<{
    completedAt: string
    createdAt: string
    runId: string
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
    workflowId: string
  }>,
) => {
  writeFileSync(
    paths.run(input.workflowId, input.runId).runFile,
    `${JSON.stringify({
      schemaVersion: 1,
      runId: input.runId,
      workflowId: input.workflowId,
      status: input.status,
      transitionCount: 0,
      lastEventSequence: 1,
      createdAt: input.createdAt,
      startedAt: input.createdAt,
      completedAt: input.completedAt,
      failureCode: input.status === 'FAILED' ? 'AGENT_FAILED' : null,
    })}\n`,
  )
}

const createFixture = async () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-run-index-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  const resources = createAtomicJsonResourceIO()
  const reads = vi.fn(resources.read.bind(resources))
  const observedResources: AtomicJsonResourceIO = { ...resources, read: reads }
  const runs = createFilesystemRunStore({ paths, resources: observedResources })
  const admit = (runId: string, createdAt: string, capturedWorkflow = workflow) =>
    runs.admit({
      runId,
      workflowId: capturedWorkflow.workflowId,
      createdAt,
      workflowSnapshot: {
        schemaVersion: 1,
        capturedAt: createdAt,
        workflowRevision: calculateResourceRevision(`${runId}-workflow`),
        workflow: capturedWorkflow,
      },
      variablesSnapshot: { schemaVersion: 1, values: { release: runId } },
      repositoriesSnapshot: {
        schemaVersion: 1,
        repositories: capturedWorkflow.repositories.repositoryIds.map((repositoryId, position) => ({
          repositoryId,
          position,
          name: repositoryId === 'repository-api' ? 'API' : 'Web',
          provider: 'GITHUB' as const,
          remoteId: repositoryId === 'repository-api' ? '123' : '456',
          fullName: repositoryId === 'repository-api' ? 'operator/api' : 'operator/web',
          cloneUrl:
            repositoryId === 'repository-api'
              ? 'https://github.com/operator/api.git'
              : 'https://github.com/operator/web.git',
          webUrl:
            repositoryId === 'repository-api'
              ? 'https://github.com/operator/api'
              : 'https://github.com/operator/web',
          defaultBranch: 'main',
          baseSha: 'a'.repeat(40),
          isPrimary: capturedWorkflow.repositories.primaryRepositoryId === repositoryId,
        })),
      },
      verifySource: async () => undefined,
    })
  await admit('run-old', '2026-08-25T09:00:00.000Z')
  await admit('run-new', '2026-08-25T10:00:00.000Z')
  await admit('run-deploy', '2026-08-25T08:00:00.000Z', deployWorkflow)
  reads.mockClear()
  const index = createFilesystemRunIndex({ paths, resources: observedResources })
  return { admit, index, paths, reads, resources: observedResources }
}

describe('filesystem run index and detail reader', () => {
  it('incrementally indexes runs with compatible ordering, filtering, and pagination', async () => {
    const fixture = await createFixture()

    await expect(fixture.index.list({ page: 1, pageSize: 1 })).resolves.toMatchObject({
      data: [{ status: 'READY', run: { runId: 'run-new' } }],
      pagination: { page: 1, pageSize: 1, totalItems: 3, totalPages: 3 },
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

    await expect(
      fixture.index.list({ page: 1, pageSize: 20, workflowIds: ['deploy-review'] }),
    ).resolves.toMatchObject({ data: [{ locator: { runId: 'run-deploy' } }] })
    await expect(
      fixture.index.list({ page: 1, pageSize: 20, repositoryIds: ['repository-web'] }),
    ).resolves.toMatchObject({ data: [{ locator: { runId: 'run-deploy' } }] })
    await expect(
      fixture.index.list({
        page: 1,
        pageSize: 20,
        workflowIds: ['history-review'],
        repositoryIds: ['repository-web'],
      }),
    ).resolves.toMatchObject({ data: [], pagination: { totalItems: 0 } })
    await expect(
      fixture.index.list({
        page: 1,
        pageSize: 20,
        repositoryIds: ['repository-api', 'repository-web'],
      }),
    ).resolves.toMatchObject({ pagination: { totalItems: 3 } })
  })

  it('returns the latest successful or failed run for each workflow', async () => {
    const fixture = await createFixture()
    writeRunProjection(fixture.paths, {
      completedAt: '2026-08-25T09:30:00.000Z',
      createdAt: '2026-08-25T09:00:00.000Z',
      runId: 'run-old',
      status: 'SUCCEEDED',
      workflowId: 'history-review',
    })
    writeRunProjection(fixture.paths, {
      completedAt: '2026-08-25T08:30:00.000Z',
      createdAt: '2026-08-25T08:00:00.000Z',
      runId: 'run-deploy',
      status: 'FAILED',
      workflowId: 'deploy-review',
    })
    await fixture.admit('run-cancelled', '2026-08-25T11:00:00.000Z', deployWorkflow)
    writeRunProjection(fixture.paths, {
      completedAt: '2026-08-25T11:30:00.000Z',
      createdAt: '2026-08-25T11:00:00.000Z',
      runId: 'run-cancelled',
      status: 'CANCELLED',
      workflowId: 'deploy-review',
    })

    await expect(fixture.index.listLatestFinished()).resolves.toEqual([
      {
        workflowId: 'history-review',
        runId: 'run-old',
        status: 'SUCCEEDED',
        completedAt: '2026-08-25T09:30:00.000Z',
      },
      {
        workflowId: 'deploy-review',
        runId: 'run-deploy',
        status: 'FAILED',
        completedAt: '2026-08-25T08:30:00.000Z',
      },
    ])
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
      workflowSnapshot: { workflow: { workflowId: 'history-review' } },
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
        { status: 'READY', run: { runId: 'run-deploy' } },
        {
          status: 'CORRUPT',
          locator: { workflowId: 'history-review', runId: 'run-old' },
          diagnostic: { code: 'RESOURCE_VALIDATION_FAILED' },
        },
      ],
      pagination: { totalItems: 3 },
    })
  })
})
