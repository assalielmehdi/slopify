import { afterEach, describe, expect, it } from 'vitest'

import {
  createRunService,
  type ReadinessService,
  type RunTaskResolver,
} from '@loop/execution-runtime'
import {
  TEST_PROFILE_ID,
  TEST_REVISION_ID,
  TEST_WORKFLOW_ID,
  createPersistenceFixture,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createFixture = () => {
  const fixture = createPersistenceFixture()
  fixtures.push(fixture)
  const readiness: ReadinessService = {
    connectorStatus: () => ({ clickup: true, gitlab: true, modelProvider: true }),
    check: async () => ({
      profileId: TEST_PROFILE_ID,
      ready: true,
      repositories: fixture.snapshot.repositories.map(({ repositoryId }) => ({
        repositoryId,
        ready: true,
        findings: [],
      })),
    }),
  }
  const tasks: RunTaskResolver = {
    resolve: async (taskReference) => ({
      id: taskReference,
      name: `Resolved ${taskReference}`,
    }),
  }
  let identity = 0
  const runs = createRunService({
    events: fixture.events,
    profiles: fixture.profiles,
    readiness,
    runs: fixture.runs,
    tasks,
    workflows: fixture.workflows,
    sources: {
      get: (commandId) =>
        commandId === 'load-clickup-task'
          ? {
              commandId,
              sourceFile: 'commands/load-clickup-task.ts',
              content: 'export const loadClickUpTask = async () => undefined\n',
            }
          : undefined,
    },
    now: () => '2026-08-18T23:15:00Z',
    createRunId: () => `run-api-${++identity}`,
    createProfileSnapshotId: () => `snapshot-api-${identity}`,
  })
  return { fixture, app: createApiApp({ database: fixture.database, runs }) }
}

const createBody = {
  taskReference: 'TASK-1',
  workflowId: TEST_WORKFLOW_ID,
  revisionId: TEST_REVISION_ID,
  profileId: TEST_PROFILE_ID,
}

describe('run JSON API', () => {
  it('creates a run and returns its exact detail', async () => {
    const { app } = createFixture()

    const createdResponse = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody),
    })
    const created = (await createdResponse.json()) as { runId: string }
    const detailResponse = await app.request(`/api/runs/${created.runId}`)
    const detail = (await detailResponse.json()) as {
      run: { runId: string }
      repositorySelection: unknown
    }

    expect(createdResponse.status).toBe(201)
    expect(created).toMatchObject({ runId: 'run-api-1', status: 'PENDING' })
    expect(detailResponse.status).toBe(200)
    expect(detail.run.runId).toBe(created.runId)
    expect(detail.repositorySelection).toBeNull()
  })

  it('lists runs through validated one-based pagination', async () => {
    const { app } = createFixture()
    await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody),
    })

    const response = await app.request('/api/runs?page=1&pageSize=1')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: [{ runId: 'run-api-1', profileId: TEST_PROFILE_ID }],
      pagination: { page: 1, pageSize: 1, totalItems: 1, totalPages: 1 },
    })
  })

  it('returns 409 with the active identity and preserves the first run', async () => {
    const { app } = createFixture()
    const first = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody),
    })
    const second = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...createBody, taskReference: 'TASK-2' }),
    })

    expect(first.status).toBe(201)
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({
      error: {
        code: 'RUN_ACTIVE',
        message: 'Another run is already active',
        details: { activeRunId: 'run-api-1' },
      },
    })
    expect(await (await app.request('/api/runs')).json()).toMatchObject({
      pagination: { totalItems: 1 },
    })
  })

  it('rejects invalid pagination and reports an unknown run consistently', async () => {
    const { app } = createFixture()

    const invalid = await app.request('/api/runs?page=0&pageSize=101')
    const unknown = await app.request('/api/runs/unknown')

    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({
      error: { code: 'RUN_NOT_FOUND', message: 'Run was not found' },
    })
  })

  it('returns only the registered source for a command in the pinned run revision', async () => {
    const { app } = createFixture()
    await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody),
    })

    const response = await app.request('/api/runs/run-api-1/nodes/load-clickup-task/source')
    const unavailable = await app.request('/api/runs/run-api-1/nodes/plan/source')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      nodeId: 'load-clickup-task',
      commandId: 'load-clickup-task',
      sourceFile: 'commands/load-clickup-task.ts',
      content: 'export const loadClickUpTask = async () => undefined\n',
    })
    expect(unavailable.status).toBe(404)
    expect(await unavailable.json()).toMatchObject({
      error: { code: 'NODE_SOURCE_UNAVAILABLE' },
    })
  })
})
