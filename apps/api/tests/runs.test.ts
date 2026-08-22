import { afterEach, describe, expect, it } from 'vitest'

import { createRunService } from '@slopify/execution-runtime'
import { createPredefinedV1Workflow } from '@slopify/workflow-model'
import {
  TEST_WORKFLOW_ID,
  createPersistenceFixture,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createFixture = () => {
  const fixture = createPersistenceFixture(
    createPredefinedV1Workflow({
      createdAt: '2026-08-18T23:15:00Z',
      agentDefaults: {
        provider: 'test-provider',
        model: 'test-model',
        thinkingLevel: 'medium',
      },
    }),
  )
  fixtures.push(fixture)
  let identity = 0
  const runs = createRunService({
    events: fixture.events,
    runs: fixture.runs,
    workflows: fixture.workflows,
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
      outputChunks: expect.any(Array),
      artifacts: expect.any(Array),
    })
    expect(detail.run).not.toHaveProperty('profileSnapshotId')
    expect(detail.run).not.toHaveProperty('taskReference')
  })

  it('rejects removed revision and task context fields in run requests', async () => {
    const { app } = createFixture()

    for (const input of [
      { ...createBody, revisionId: 'revision-01' },
      { ...createBody, taskReference: 'TASK-1' },
      { ...createBody, profileId: 'profile-01' },
    ]) {
      const response = await app.request('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    }
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
      body: JSON.stringify({ ...createBody, variables: { objective: 'second' } }),
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

  it('does not expose the removed node-source route', async () => {
    const { app } = createFixture()
    const response = await app.request('/api/runs/run-api-1/nodes/identify-agent/source')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    })
  })
})
