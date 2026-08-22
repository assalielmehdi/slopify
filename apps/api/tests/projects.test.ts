import { afterEach, describe, expect, it } from 'vitest'

import {
  createProjectRepository,
  createProjectService,
  createDeletionOperationRepository,
  createDeletionService,
  type ProjectInspection,
} from '@slopify/execution-runtime'
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
  let timestamp = '2026-08-21T10:00:00Z'
  const projects = createProjectService({
    projects: createProjectRepository(fixture.database),
    inspector: { inspect: async () => inspection },
    createId: () => 'project-01',
    createDeletionId: () => 'deletion-01',
    now: () => timestamp,
  })
  const deletions = createDeletionService({
    operations: createDeletionOperationRepository(fixture.database),
    handlers: [projects],
  })
  return {
    app: createApiApp({ database: fixture.database, deletions, projects }),
    setInspection(next: ProjectInspection) {
      inspection = next
    },
    setNow(next: string) {
      timestamp = next
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

  it('deletes a project, returns an undo receipt, and restores it through the generic endpoint', async () => {
    const fixture = createFixture()
    await fixture.app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repositoryPath: '/workspace/slopify' }),
    })

    const deleted = await fixture.app.request('/api/projects/project-01', { method: 'DELETE' })
    const listedAfterDelete = await fixture.app.request('/api/projects')
    const undone = await fixture.app.request('/api/deletions/deletion-01/undo', { method: 'POST' })
    const listedAfterUndo = await fixture.app.request('/api/projects')

    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({
      deletionId: 'deletion-01',
      subject: { type: 'PROJECT', id: 'project-01' },
      deletedAt: '2026-08-21T10:00:00Z',
      undoExpiresAt: '2026-08-21T10:00:10.000Z',
    })
    expect(await listedAfterDelete.json()).toEqual({ projects: [] })
    expect(undone.status).toBe(200)
    expect(await undone.json()).toMatchObject({ deletionId: 'deletion-01', state: 'UNDONE' })
    expect(await listedAfterUndo.json()).toMatchObject({
      projects: [expect.objectContaining({ projectId: 'project-01' })],
    })
    const undoneAgain = await fixture.app.request('/api/deletions/deletion-01/undo', {
      method: 'POST',
    })
    expect(undoneAgain.status).toBe(200)
  })

  it('rejects undo after the server-authoritative window expires', async () => {
    const fixture = createFixture()
    await fixture.app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repositoryPath: '/workspace/slopify' }),
    })
    await fixture.app.request('/api/projects/project-01', { method: 'DELETE' })
    fixture.setNow('2026-08-21T10:00:10Z')

    const expired = await fixture.app.request('/api/deletions/deletion-01/undo', {
      method: 'POST',
    })

    expect(expired.status).toBe(410)
    expect(await expired.json()).toEqual({
      error: {
        code: 'DELETION_UNDO_EXPIRED',
        message: 'The undo window has expired',
      },
    })
  })
})
