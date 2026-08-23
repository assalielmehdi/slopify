import { afterEach, describe, expect, it } from 'vitest'

import { createRunService } from '@slopify/execution-runtime'
import {
  TEST_WORKFLOW_ID,
  createTestHarnessCatalog,
  createTestAgentWorkflow,
  createPersistenceFixture,
  resolveTestProject,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createFixture = () => {
  const workflow = createTestAgentWorkflow({
    createdAt: '2026-08-19T07:30:00Z',
    prompt: 'Deliver {{objective}} for {{project}}.',
    projectIds: ['project-api'],
    primaryProjectId: 'project-api',
    variables: ['objective', 'project'],
  })
  const fixture = createPersistenceFixture(workflow)
  fixtures.push(fixture)
  const runs = createRunService({
    events: fixture.events,
    runs: fixture.runs,
    workflows: fixture.workflows,
    harnesses: createTestHarnessCatalog(),
    resolveProject: resolveTestProject,
    now: () => '2026-08-19T07:30:00Z',
    createRunId: () => 'run-start-01',
  })
  return { app: createApiApp({ database: fixture.database, runs }), runs }
}

describe('start run admission', () => {
  it('persists immutable workflow and variable snapshots before execution', async () => {
    const { app, runs } = createFixture()

    const response = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: TEST_WORKFLOW_ID,
        variables: { objective: 'Ship the API', project: 'Slopify' },
      }),
    })

    expect(response.status).toBe(201)
    expect(runs.get('run-start-01')).toMatchObject({
      run: {
        status: 'PENDING',
        workflowSnapshot: expect.objectContaining({ workflowId: TEST_WORKFLOW_ID }),
        variables: { objective: 'Ship the API', project: 'Slopify' },
      },
    })
  })

  it('rejects variables that do not exactly match the workflow configuration', async () => {
    const { app, runs } = createFixture()

    const missing = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflowId: TEST_WORKFLOW_ID }),
    })

    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({
      error: {
        code: 'RUN_VARIABLES_INVALID',
        message: 'Run variables must exactly match the workflow configuration',
      },
    })
    expect(runs.list({ page: 1, pageSize: 20 }).data).toEqual([])

    const extra = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: TEST_WORKFLOW_ID,
        variables: { objective: 'Ship', project: 'Slopify', typo: true },
      }),
    })

    expect(extra.status).toBe(400)
    expect(await extra.json()).toEqual({
      error: {
        code: 'RUN_VARIABLES_INVALID',
        message: 'Run variables must exactly match the workflow configuration',
      },
    })
    expect(runs.list({ page: 1, pageSize: 20 }).data).toEqual([])
  })
})
