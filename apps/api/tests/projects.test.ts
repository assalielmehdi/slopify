import { afterEach, describe, expect, it } from 'vitest'

import {
  createProjectRepository,
  createProjectService,
  type ProjectInspection,
} from '@loop/execution-runtime'
import { createPersistenceFixture } from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createFixture = () => {
  const fixture = createPersistenceFixture()
  fixtures.push(fixture)
  let inspection: ProjectInspection = {
    status: 'AVAILABLE',
    canonicalPath: '/workspace/slopify',
    name: 'slopify',
  }
  const projects = createProjectService({
    projects: createProjectRepository(fixture.database),
    inspector: { inspect: async () => inspection },
    createId: () => 'project-01',
    now: () => '2026-08-21T10:00:00Z',
  })
  return {
    app: createApiApp({ database: fixture.database, projects }),
    setInspection(next: ProjectInspection) {
      inspection = next
    },
  }
}

describe('projects API', () => {
  it('adds a local Git repository and returns live availability when listing', async () => {
    const fixture = createFixture()
    const created = await fixture.app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repositoryPath: '/workspace/slopify' }),
    })
    fixture.setInspection({ status: 'MISSING' })
    const listed = await fixture.app.request('/api/projects')

    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({
      projectId: 'project-01',
      name: 'slopify',
      availability: 'AVAILABLE',
    })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({
      projects: [expect.objectContaining({ projectId: 'project-01', availability: 'MISSING' })],
    })
  })

  it('rejects relative, missing, and non-Git project paths with stable errors', async () => {
    const fixture = createFixture()
    const relative = await fixture.app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repositoryPath: 'workspace/slopify' }),
    })
    fixture.setInspection({ status: 'NOT_GIT_REPOSITORY' })
    const nonGit = await fixture.app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repositoryPath: '/workspace/folder' }),
    })

    expect(relative.status).toBe(400)
    expect(await relative.json()).toMatchObject({ error: { code: 'PROJECT_INVALID' } })
    expect(nonGit.status).toBe(422)
    expect(await nonGit.json()).toEqual({
      error: {
        code: 'PROJECT_NOT_GIT_REPOSITORY',
        message: 'Project path must be a Git repository',
      },
    })
  })

  it('deletes a project and returns not found when it is already absent', async () => {
    const fixture = createFixture()
    await fixture.app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repositoryPath: '/workspace/slopify' }),
    })

    const deleted = await fixture.app.request('/api/projects/project-01', { method: 'DELETE' })
    const missing = await fixture.app.request('/api/projects/project-01', { method: 'DELETE' })

    expect(deleted.status).toBe(204)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      error: { code: 'PROJECT_NOT_FOUND', message: 'Project was not found' },
    })
  })
})
