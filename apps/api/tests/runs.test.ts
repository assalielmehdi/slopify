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
  createRunService,
  resolveSlopifyPaths,
  type FilesystemRunRepositoryResolution,
} from '@slopify/execution-runtime'
import {
  TEST_WORKFLOW_ID,
  createTestHarnessCatalog,
  createTestAgentWorkflow,
  createPersistenceFixture,
  resolveTestRepository,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []
const directories: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const createFixture = () => {
  const fixture = createPersistenceFixture(
    createTestAgentWorkflow({
      createdAt: '2026-08-18T23:15:00Z',
      repositoryIds: ['repository-api'],
      primaryRepositoryId: 'repository-api',
    }),
  )
  fixtures.push(fixture)
  let identity = 0
  const runs = createRunService({
    events: fixture.events,
    runs: fixture.runs,
    workflows: fixture.workflows,
    harnesses: createTestHarnessCatalog(),
    resolveRepository: resolveTestRepository,
    now: () => '2026-08-18T23:15:00Z',
    createRunId: () => `run-api-${++identity}`,
  })
  return { runs, app: createApiApp({ database: fixture.database, runs }) }
}

const createBody = { workflowId: TEST_WORKFLOW_ID }

describe('run JSON API', () => {
  it('creates a self-contained run and returns its exact public detail', async () => {
    const { app } = createFixture()
    const createdResponse = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody),
    })
    const created = (await createdResponse.json()) as { runId: string }
    const detailResponse = await app.request(`/api/runs/${created.runId}`)
    const detail = (await detailResponse.json()) as {
      run: { runId: string; workflowSnapshot: { workflowId: string } }
    }

    expect(createdResponse.status).toBe(201)
    expect(created).toMatchObject({ runId: 'run-api-1', status: 'PENDING' })
    expect(detailResponse.status).toBe(200)
    expect(detail.run.runId).toBe(created.runId)
    expect(detail.run.workflowSnapshot.workflowId).toBe(TEST_WORKFLOW_ID)
    expect(detail).toEqual({
      run: expect.any(Object),
      events: expect.any(Array),
      nodeExecutions: expect.any(Array),
      repositories: expect.any(Array),
      repositoryWorkspaces: expect.any(Array),
    })
  })

  it('rejects unknown fields in run requests', async () => {
    const { app } = createFixture()

    const response = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...createBody, unexpected: true }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })

  it('lists minimal run summaries through validated one-based pagination', async () => {
    const { app } = createFixture()
    await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody),
    })

    const response = await app.request('/api/runs?page=1&pageSize=1')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          runId: 'run-api-1',
          workflowId: TEST_WORKFLOW_ID,
          status: 'PENDING',
          createdAt: '2026-08-18T23:15:00Z',
          startedAt: null,
          completedAt: null,
          durationMs: null,
        },
      ],
      pagination: { page: 1, pageSize: 1, totalItems: 1, totalPages: 1 },
    })
  })

  it('admits independent runs concurrently', async () => {
    const { app } = createFixture()
    const first = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody),
    })
    const second = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody),
    })

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(await second.json()).toMatchObject({ runId: 'run-api-2', status: 'PENDING' })
    expect(await (await app.request('/api/runs')).json()).toMatchObject({
      pagination: { totalItems: 2 },
    })
  })

  it('passes repeated and typed filters through to server-backed pagination', async () => {
    const { app } = createFixture()
    await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody),
    })
    await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody),
    })

    const response = await app.request(
      '/api/runs?page=1&pageSize=20&runId=api-1&status=PENDING&status=FAILED',
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: [{ runId: 'run-api-1' }],
      pagination: { totalItems: 1, totalPages: 1 },
    })
  })

  it('returns 503 without creating a run after shutdown closes admissions', async () => {
    const { app, runs } = createFixture()
    runs.stopAdmissions()

    const response = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: { code: 'RUN_ADMISSION_CLOSED', message: 'Run admissions are closed' },
    })
    expect(runs.list({ page: 1, pageSize: 20 }).data).toEqual([])
  })

  it('rejects invalid pagination and reports an unknown run consistently', async () => {
    const { app } = createFixture()
    const invalid = await app.request('/api/runs?page=0&pageSize=101')
    const invalidFilters = await app.request('/api/runs?durationMinMs=2000&durationMaxMs=1000')
    const unknown = await app.request('/api/runs/unknown')

    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    expect(invalidFilters.status).toBe(400)
    expect(await invalidFilters.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({
      error: { code: 'RUN_NOT_FOUND', message: 'Run was not found' },
    })
  })
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
