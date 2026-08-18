import { afterEach, describe, expect, it } from 'vitest'

import { createWorkflowService } from '@loop/execution-runtime'
import { createPersistenceFixture } from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createFixture = () => {
  const fixture = createPersistenceFixture()
  fixtures.push(fixture)
  const workflows = createWorkflowService({
    workflows: fixture.workflows,
    now: () => '2026-08-18T23:00:00Z',
  })
  return { fixture, app: createApiApp({ database: fixture.database, workflows }) }
}

describe('workflow API', () => {
  it('lists revision summaries newest first and returns an exact immutable revision', async () => {
    const { fixture, app } = createFixture()

    const listResponse = await app.request('/api/workflows')
    const revisionResponse = await app.request(
      `/api/workflows/${fixture.revision.workflowId}/revisions/${fixture.revision.revisionId}`,
    )

    expect(listResponse.status).toBe(200)
    expect(await listResponse.json()).toEqual({
      workflows: [
        {
          workflowId: fixture.revision.workflowId,
          name: fixture.revision.name,
          latestRevisionId: fixture.revision.revisionId,
          revisions: [
            {
              revisionId: fixture.revision.revisionId,
              parentRevisionId: null,
              createdAt: fixture.revision.createdAt,
            },
          ],
        },
      ],
    })
    expect(revisionResponse.status).toBe(200)
    expect(await revisionResponse.json()).toEqual(fixture.revision)
  })

  it('creates a validated derived revision without changing its parent', async () => {
    const { fixture, app } = createFixture()

    const response = await app.request(`/api/workflows/${fixture.revision.workflowId}/revisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        parentRevisionId: fixture.revision.revisionId,
        revisionId: 'revision-02',
        updates: [{ nodeId: 'plan', changes: { model: 'test-model-v2' } }],
      }),
    })
    const created = (await response.json()) as typeof fixture.revision
    const parent = fixture.workflows.getRevision({
      workflowId: fixture.revision.workflowId,
      revisionId: fixture.revision.revisionId,
    })

    expect(response.status).toBe(201)
    expect(created).toMatchObject({
      workflowId: fixture.revision.workflowId,
      revisionId: 'revision-02',
      parentRevisionId: fixture.revision.revisionId,
      createdAt: '2026-08-18T23:00:00Z',
    })
    expect(created.nodes.find(({ id }) => id === 'plan')).toMatchObject({
      type: 'agent',
      model: 'test-model-v2',
    })
    expect(parent).toEqual(fixture.revision)
  })

  it('maps malformed and semantically invalid revision requests to stable errors', async () => {
    const { fixture, app } = createFixture()

    const malformed = await app.request(`/api/workflows/${fixture.revision.workflowId}/revisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentRevisionId: fixture.revision.revisionId }),
    })
    const invalid = await app.request(`/api/workflows/${fixture.revision.workflowId}/revisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        parentRevisionId: fixture.revision.revisionId,
        revisionId: 'revision-02',
        updates: [{ nodeId: 'verify', changes: { model: 'not-allowed' } }],
      }),
    })

    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({
      error: { code: 'WORKFLOW_REQUEST_INVALID' },
    })
    expect(invalid.status).toBe(422)
    expect(await invalid.json()).toMatchObject({ error: { code: 'REVISION_INVALID' } })
  })

  it('returns the shared not-found envelope for unknown revisions', async () => {
    const { fixture, app } = createFixture()

    const response = await app.request(
      `/api/workflows/${fixture.revision.workflowId}/revisions/unknown`,
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow revision was not found' },
    })
  })
})
