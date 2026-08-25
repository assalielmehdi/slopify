import { afterEach, describe, expect, it } from 'vitest'

import { createRunService } from '@slopify/execution-runtime'
import {
  TEST_WORKFLOW_ID,
  createTestHarnessCatalog,
  createTestAgentWorkflow,
  createPersistenceFixture,
  resolveTestRepository,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
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
