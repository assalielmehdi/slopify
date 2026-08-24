import type { GitProvider, GitRepository } from '@slopify/contracts'
import {
  GitConnectionServiceError,
  createDeletionOperationRepository,
  createDeletionService,
  createProjectRepository,
  createProjectService,
  type RemoteGitHost,
} from '@slopify/execution-runtime'
import { afterEach, describe, expect, it } from 'vitest'

import { createPersistenceFixture } from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

const repository: GitRepository = {
  provider: 'GITHUB',
  remoteId: '123',
  name: 'slopify',
  fullName: 'operator/slopify',
  cloneUrl: 'https://github.com/operator/slopify.git',
  webUrl: 'https://github.com/operator/slopify',
  visibility: 'PRIVATE',
  defaultBranch: 'main',
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createFixture = () => {
  const fixture = createPersistenceFixture()
  fixtures.push(fixture)
  let repositoryAvailable = true
  let timestamp = '2026-08-21T10:00:00Z'
  const connected = new Set<GitProvider>(['GITHUB'])
  const remote: RemoteGitHost = {
    authenticate: async (provider) => ({ provider, accountUsername: 'operator' }),
    listRepositories: async () => (repositoryAvailable ? [repository] : []),
    getRepository: async (provider, _token, remoteId) =>
      repositoryAvailable && provider === repository.provider && remoteId === repository.remoteId
        ? repository
        : undefined,
    getDefaultBranchSha: async () => 'a'.repeat(40) as never,
  }
  const projects = createProjectService({
    projects: createProjectRepository(fixture.database),
    connections: {
      requireToken: async (provider) => {
        if (connected.has(provider)) return 'token'
        throw new GitConnectionServiceError('GIT_CONNECTION_NOT_FOUND', 'Provider not connected')
      },
    },
    remote,
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
    disconnect(provider: GitProvider) {
      connected.delete(provider)
    },
    setRepositoryAvailable(available: boolean) {
      repositoryAvailable = available
    },
    setNow(next: string) {
      timestamp = next
    },
  }
}

const addProject = (app: ReturnType<typeof createApiApp>) =>
  app.request('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'GITHUB', remoteId: '123' }),
  })

describe('projects API', () => {
  it('adds a connected remote repository and returns live availability when listing', async () => {
    const fixture = createFixture()
    const created = await addProject(fixture.app)
    fixture.setRepositoryAvailable(false)
    const listed = await fixture.app.request('/api/projects')

    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({
      projectId: 'project-01',
      name: 'slopify',
      provider: 'GITHUB',
      fullName: 'operator/slopify',
      availability: 'AVAILABLE',
    })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({
      projects: [
        expect.objectContaining({
          projectId: 'project-01',
          availability: 'REPOSITORY_UNAVAILABLE',
        }),
      ],
    })
  })

  it('requires a connected provider and an existing remote repository', async () => {
    const fixture = createFixture()
    fixture.disconnect('GITHUB')
    const disconnected = await addProject(fixture.app)

    expect(disconnected.status).toBe(422)
    expect(await disconnected.json()).toMatchObject({
      error: { code: 'PROJECT_CONNECTION_REQUIRED' },
    })

    const connectedFixture = createFixture()
    connectedFixture.setRepositoryAvailable(false)
    const missing = await addProject(connectedFixture.app)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      error: {
        code: 'PROJECT_REPOSITORY_NOT_FOUND',
        message: 'Repository could not be found',
      },
    })
  })

  it('deletes a project, returns an undo receipt, and restores it through the generic endpoint', async () => {
    const fixture = createFixture()
    await addProject(fixture.app)

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
    await addProject(fixture.app)
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
