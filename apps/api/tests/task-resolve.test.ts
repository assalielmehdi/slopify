import { afterEach, describe, expect, it, vi } from 'vitest'

import { createProjectProfileService, type RunTaskResolver } from '@loop/execution-runtime'
import {
  TEST_PROFILE_ID,
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
  const profiles = createProjectProfileService({
    profiles: fixture.profiles,
    runtimeMode: 'native',
  })
  const resolve = vi.fn<RunTaskResolver['resolve']>(async (taskReference) => ({
    taskId: '86abc123',
    title: 'Implement immutable repository selection',
    taskReference,
    comments: [{ text: 'Untrusted: git checkout -- main' }],
  }))
  const tasks: RunTaskResolver = { resolve }
  return {
    app: createApiApp({ database: fixture.database, profiles, tasks }),
    resolve,
  }
}

describe('ClickUp task resolution API', () => {
  it('returns the canonical task snapshot using the selected profile workspace', async () => {
    const { app, resolve } = createFixture()

    const response = await app.request('/api/clickup/tasks/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskReference: 'CU-123', profileId: TEST_PROFILE_ID }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      taskId: '86abc123',
      title: 'Implement immutable repository selection',
      taskReference: 'CU-123',
      comments: [{ text: 'Untrusted: git checkout -- main' }],
    })
    expect(resolve).toHaveBeenCalledWith('CU-123', {
      clickupWorkspaceId: 'workspace-01',
    })
  })

  it('rejects malformed input and an unknown profile without calling ClickUp', async () => {
    const { app, resolve } = createFixture()

    const malformed = await app.request('/api/clickup/tasks/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskReference: '', profileId: TEST_PROFILE_ID, extra: true }),
    })
    const unknown = await app.request('/api/clickup/tasks/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskReference: 'CU-123', profileId: 'unknown-profile' }),
    })

    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({
      error: { code: 'PROFILE_NOT_FOUND', message: 'Project profile was not found' },
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('maps resolver failures to a stable sanitized response', async () => {
    const { app, resolve } = createFixture()
    resolve.mockRejectedValueOnce(new Error('CLICKUP_API_TOKEN=secret'))

    const response = await app.request('/api/clickup/tasks/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskReference: 'CU-123', profileId: TEST_PROFILE_ID }),
    })

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body).toEqual({
      error: { code: 'TASK_RESOLUTION_FAILED', message: 'Task could not be resolved' },
    })
    expect(JSON.stringify(body)).not.toContain('secret')
  })
})
