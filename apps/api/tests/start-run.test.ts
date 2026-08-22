import { afterEach, describe, expect, it } from 'vitest'

import { createRunService } from '@slopify/execution-runtime'
import { createPredefinedV1Workflow, WorkflowSchema } from '@slopify/workflow-model'
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
  const base = createPredefinedV1Workflow({
    createdAt: '2026-08-19T07:30:00Z',
    agentDefaults: {
      provider: 'test-provider',
      model: 'test-model',
      thinkingLevel: 'medium',
    },
  })
  const workflow = WorkflowSchema.parse({
    ...base,
    nodes: base.nodes.map((node) =>
      node.type === 'agent'
        ? { ...node, job: { ...node.job, prompt: 'Deliver {{objective}} for {{project}}.' } }
        : node,
    ),
  })
  const fixture = createPersistenceFixture(workflow)
  fixtures.push(fixture)
  const runs = createRunService({
    events: fixture.events,
    runs: fixture.runs,
    workflows: fixture.workflows,
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
        missingVariables: [],
      },
    })
  })

  it('reports missing variables and admits them only after explicit confirmation', async () => {
    const { app, runs } = createFixture()

    const missing = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflowId: TEST_WORKFLOW_ID }),
    })

    expect(missing.status).toBe(409)
    expect(await missing.json()).toEqual({
      error: {
        code: 'RUN_VARIABLES_MISSING',
        message: 'Required workflow variables are missing',
        details: { missingVariables: ['objective', 'project'] },
      },
    })
    expect(runs.list({ page: 1, pageSize: 20 }).data).toEqual([])

    const confirmed = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflowId: TEST_WORKFLOW_ID, confirmMissingVariables: true }),
    })

    expect(confirmed.status).toBe(201)
    expect(await confirmed.json()).toMatchObject({
      variables: {},
      missingVariables: ['objective', 'project'],
    })
  })
})
