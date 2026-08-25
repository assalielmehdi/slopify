import { afterEach, describe, expect, it } from 'vitest'

import { createWorkflowService } from '@slopify/execution-runtime'
import {
  createTestHarnessCatalog,
  createTestAgentWorkflow,
  createPersistenceFixture,
  createRun,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createFixture = () => {
  const fixture = createPersistenceFixture(
    createTestAgentWorkflow({
      createdAt: '2026-08-18T20:00:00Z',
    }),
  )
  fixtures.push(fixture)
  const workflows = createWorkflowService({
    workflows: fixture.workflows,
    harnesses: createTestHarnessCatalog(),
    createId: () => 'workflow-release',
    now: () => '2026-08-24T14:00:00.000Z',
  })
  return { fixture, app: createApiApp({ database: fixture.database, workflows }) }
}

describe('workflow API', () => {
  it('creates and returns a canonical empty workflow', async () => {
    const { fixture, app } = createFixture()

    const response = await app.request('/api/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'release-workflow',
        description: 'Prepare and review a release.',
        configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
      }),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      workflowId: 'workflow-release',
      name: 'release-workflow',
      nodes: [],
      edges: [],
    })
    expect(fixture.workflows.get('workflow-release')).toMatchObject({
      workflowId: 'workflow-release',
    })
  })

  it('rejects client-owned creation fields', async () => {
    const { app } = createFixture()

    const response = await app.request('/api/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: 'client-owned',
        name: 'release-workflow',
        description: 'Prepare and review a release.',
        configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })

  it('returns a conflict for a duplicate workflow name', async () => {
    const { app } = createFixture()

    const input = {
      name: 'release-workflow',
      description: 'Duplicate workflow.',
      configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
    }
    await app.request('/api/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })

    const response = await app.request('/api/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: 'WORKFLOW_NAME_CONFLICT',
        message: 'Workflow name already exists',
      },
    })
  })

  it('lists current workflows and returns one exact workflow', async () => {
    const { fixture, app } = createFixture()

    const listResponse = await app.request('/api/workflows')
    const workflowResponse = await app.request(`/api/workflows/${fixture.workflow.workflowId}`)

    expect(listResponse.status).toBe(200)
    expect(await listResponse.json()).toEqual({ workflows: [fixture.workflow] })
    expect(workflowResponse.status).toBe(200)
    expect(await workflowResponse.json()).toEqual(fixture.workflow)
  })

  it('deletes a current workflow while preserving admitted run history', async () => {
    const { fixture, app } = createFixture()
    const admittedRun = createRun(fixture)

    const response = await app.request(`/api/workflows/${fixture.workflow.workflowId}`, {
      method: 'DELETE',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      subject: { type: 'WORKFLOW', id: fixture.workflow.workflowId },
    })
    expect(fixture.workflows.get(fixture.workflow.workflowId)).toBeUndefined()
    expect(fixture.runs.get(admittedRun.runId)?.workflowSnapshot).toEqual(fixture.workflow)
  })

  it('returns the shared not-found envelope for an unknown workflow', async () => {
    const { app } = createFixture()

    const response = await app.request('/api/workflows/unknown')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow was not found' },
    })
  })

  it('updates and returns the canonical workflow', async () => {
    const { fixture, app } = createFixture()
    const admittedRun = createRun(fixture)
    const response = await app.request(`/api/workflows/${fixture.workflow.workflowId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...fixture.workflow, name: 'edited-workflow' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      workflowId: fixture.workflow.workflowId,
      name: 'edited-workflow',
    })
    expect(fixture.runs.get(admittedRun.runId)?.workflowSnapshot).toEqual(fixture.workflow)
  })

  it('updates a branched workflow graph', async () => {
    const { fixture, app } = createFixture()
    const firstAgent = fixture.workflow.nodes[0]
    if (firstAgent === undefined) throw new Error('Expected an agent fixture')
    const response = await app.request(`/api/workflows/${fixture.workflow.workflowId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...fixture.workflow,
        nodes: [
          firstAgent,
          { ...firstAgent, id: 'review-agent', name: 'Review agent' },
          { ...firstAgent, id: 'publish-agent', name: 'Publish agent' },
        ],
        edges: [
          {
            sourceNodeId: firstAgent.id,
            targetNodeId: 'review-agent',
            outcome: 'completed',
            label: 'Completed',
          },
          {
            sourceNodeId: firstAgent.id,
            targetNodeId: 'publish-agent',
            outcome: 'completed',
            label: 'Completed',
          },
        ],
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'review-agent' }),
        expect.objectContaining({ id: 'publish-agent' }),
      ]),
      edges: [
        expect.objectContaining({ sourceNodeId: firstAgent.id, targetNodeId: 'review-agent' }),
        expect.objectContaining({ sourceNodeId: firstAgent.id, targetNodeId: 'publish-agent' }),
      ],
    })
  })
})
