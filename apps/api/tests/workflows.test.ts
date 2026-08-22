import { afterEach, describe, expect, it } from 'vitest'

import { createWorkflowService } from '@slopify/execution-runtime'
import { createPredefinedV1Workflow } from '@slopify/workflow-model'
import { createPersistenceFixture } from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
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
})
