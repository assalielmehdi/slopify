import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkflowFile } from '@slopify/workflow-model'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createFilesystemRunAdmissionService,
  createFilesystemRunIndex,
  createFilesystemRunReader,
  createFilesystemRunStore,
  createFilesystemWorkflowStore,
  resolveSlopifyPaths,
  type FilesystemRunRepositoryResolution,
} from '@slopify/execution-runtime'
import { createApiApp } from '../src/app.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const filesystemWorkflow: WorkflowFile = {
  schemaVersion: 2,
  workflowId: 'filesystem-review',
  name: 'Filesystem review',
  description: 'Review a filesystem-backed run.',
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
  createdAt: '2026-08-25T10:00:00.000Z',
  updatedAt: '2026-08-25T10:00:00.000Z',
}

const filesystemRepository: FilesystemRunRepositoryResolution = {
  repositoryId: 'repository-api' as FilesystemRunRepositoryResolution['repositoryId'],
  name: 'API',
  provider: 'GITHUB',
  remoteId: '123',
  fullName: 'operator/api',
  cloneUrl: 'https://github.com/operator/api.git',
  webUrl: 'https://github.com/operator/api',
  defaultBranch: 'main',
  baseSha: 'a'.repeat(40) as FilesystemRunRepositoryResolution['baseSha'],
}

const createFilesystemFixture = async () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-api-filesystem-runs-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  const workflows = createFilesystemWorkflowStore({ paths })
  await workflows.create(filesystemWorkflow)
  const admissions = createFilesystemRunAdmissionService({
    workflows,
    runs: createFilesystemRunStore({ paths }),
    harnesses: { requireAvailable: vi.fn(async () => undefined) },
    resolveRepository: async () => filesystemRepository,
    now: () => '2026-08-25T10:30:00.000Z',
    createRunId: () => 'run-filesystem-1',
  })
  const index = createFilesystemRunIndex({ paths })
  const reader = createFilesystemRunReader({ index, paths })
  return {
    app: createApiApp({ filesystemRuns: { admissions, index, reader } }),
    paths,
  }
}

describe('filesystem run JSON API', () => {
  it('accepts admission and serves list and detail from durable run artifacts', async () => {
    const fixture = await createFilesystemFixture()

    const created = await fixture.app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflowId: 'filesystem-review', variables: { release: 'v1.0.0' } }),
    })
    const list = await fixture.app.request('/api/runs?page=1&pageSize=20')
    const detail = await fixture.app.request('/api/runs/run-filesystem-1')

    expect(created.status).toBe(202)
    expect(await created.json()).toMatchObject({
      runId: 'run-filesystem-1',
      workflowId: 'filesystem-review',
      status: 'PENDING',
    })
    expect(await list.json()).toMatchObject({
      data: [{ status: 'READY', run: { runId: 'run-filesystem-1' } }],
      pagination: { totalItems: 1 },
    })
    expect(await detail.json()).toMatchObject({
      status: 'READY',
      run: { runId: 'run-filesystem-1' },
      workflowSnapshot: { workflow: { workflowId: 'filesystem-review' } },
      variablesSnapshot: { values: { release: 'v1.0.0' } },
      repositoriesSnapshot: { repositories: [{ repositoryId: 'repository-api' }] },
    })
  })

  it('keeps a corrupt run visible in list and detail responses', async () => {
    const fixture = await createFilesystemFixture()
    await fixture.app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflowId: 'filesystem-review', variables: { release: 'v1.0.0' } }),
    })
    writeFileSync(
      fixture.paths.run('filesystem-review', 'run-filesystem-1').runFile,
      '{"schemaVersion":1}\n',
    )

    const list = await fixture.app.request('/api/runs')
    const detail = await fixture.app.request('/api/runs/run-filesystem-1')

    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject({
      data: [
        {
          status: 'CORRUPT',
          locator: { workflowId: 'filesystem-review', runId: 'run-filesystem-1' },
          diagnostic: { code: 'RESOURCE_VALIDATION_FAILED' },
        },
      ],
    })
    expect(detail.status).toBe(200)
    expect(await detail.json()).toMatchObject({
      status: 'CORRUPT',
      diagnostic: { code: 'RESOURCE_VALIDATION_FAILED' },
    })
  })
})
