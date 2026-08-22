import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWorkflowService } from '@slopify/execution-runtime'
import { createPredefinedV1Workflow } from '@slopify/workflow-model'
import {
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
    createPredefinedV1Workflow({
      createdAt: '2026-08-18T20:00:00Z',
      agentDefaults: {
        provider: 'test-provider',
        model: 'test-model',
        thinkingLevel: 'medium',
      },
    }),
  )
  fixtures.push(fixture)
  const workflows = createWorkflowService({ workflows: fixture.workflows })
  return { fixture, app: createApiApp({ database: fixture.database, workflows }) }
}

describe('workflow API', () => {
  it('lists current workflows and returns one exact workflow', async () => {
    const { fixture, app } = createFixture()

    const listResponse = await app.request('/api/workflows')
    const workflowResponse = await app.request(`/api/workflows/${fixture.workflow.workflowId}`)

    expect(listResponse.status).toBe(200)
    expect(await listResponse.json()).toEqual({ workflows: [fixture.workflow] })
    expect(workflowResponse.status).toBe(200)
    expect(await workflowResponse.json()).toEqual(fixture.workflow)
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
      body: JSON.stringify({ ...fixture.workflow, name: 'Edited workflow' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      workflowId: fixture.workflow.workflowId,
      name: 'Edited workflow',
    })
    expect(fixture.runs.get(admittedRun.runId)?.workflowSnapshot).toEqual(fixture.workflow)
  })

  it('returns a stable conflict for a stale live skill selection', async () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const workflows = createWorkflowService({
      workflows: fixture.workflows,
      skills: {
        refresh: vi.fn(),
        get: vi.fn(async () => ({
          skillId: 'research',
          name: 'research',
          description: 'Research.',
          digest: 'c'.repeat(64),
          modifiedAt: '2026-08-22T10:00:00.000Z',
          valid: true,
          issues: [],
          files: [],
        })),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      skillSnapshots: { capture: vi.fn(), get: vi.fn() },
    })
    const app = createApiApp({ database: fixture.database, workflows })
    const agent = fixture.workflow.nodes.find((node) => node.type === 'agent')
    if (agent?.type !== 'agent') throw new Error('Expected the fixture agent')
    const response = await app.request(`/api/workflows/${fixture.workflow.workflowId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...fixture.workflow,
        nodes: [
          {
            ...agent,
            job: {
              ...agent.job,
              skillSnapshotRefs: [
                {
                  skillId: 'research',
                  snapshotId: `sha256:${'b'.repeat(64)}`,
                  digest: 'b'.repeat(64),
                  name: 'research',
                  description: 'Research.',
                },
              ],
            },
          },
        ],
      }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: 'WORKFLOW_SKILL_MISMATCH',
        message: 'Workflow skill selection no longer matches the live catalog',
      },
    })
  })

  it('rejects a branched workflow update', async () => {
    const { fixture, app } = createFixture()
    const firstAgent = fixture.workflow.nodes[0]
    if (firstAgent?.type !== 'agent') throw new Error('Expected an agent fixture')
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

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: {
        code: 'WORKFLOW_NOT_LINEAR',
        message: 'Workflow agents must form one linear chain',
      },
    })
  })
})
