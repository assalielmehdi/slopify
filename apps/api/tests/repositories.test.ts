import type { GitProvider, GitRepository } from '@slopify/contracts'
import {
  GitConnectionServiceError,
  createDeletionOperationRepository,
  createDeletionService,
  createRepositoryStore,
  createRepositoryService,
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
  const timestamp = '2026-08-21T10:00:00Z'
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
  const repositories = createRepositoryService({
    repositories: createRepositoryStore(fixture.database),
    connections: {
      requireToken: async (provider) => {
        if (connected.has(provider)) return 'token'
        throw new GitConnectionServiceError('GIT_CONNECTION_NOT_FOUND', 'Provider not connected')
      },
    },
    remote,
    createId: () => 'repository-01',
    createDeletionId: () => 'deletion-01',
    now: () => timestamp,
  })
  const deletions = createDeletionService({
    operations: createDeletionOperationRepository(fixture.database),
    handlers: [repositories],
  })
  return {
    app: createApiApp({ database: fixture.database, deletions, repositories }),
    disconnect(provider: GitProvider) {
      connected.delete(provider)
    },
    setRepositoryAvailable(available: boolean) {
      repositoryAvailable = available
    },
  }
}

const addRepository = (app: ReturnType<typeof createApiApp>) =>
  app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'GITHUB', remoteId: '123' }),
  })

describe('repositories API', () => {
  it('adds a connected remote repository and returns live availability when listing', async () => {
    const fixture = createFixture()
    const created = await addRepository(fixture.app)
    fixture.setRepositoryAvailable(false)
    const listed = await fixture.app.request('/api/repositories')

    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({
      repositoryId: 'repository-01',
      name: 'slopify',
      provider: 'GITHUB',
      fullName: 'operator/slopify',
      availability: 'AVAILABLE',
    })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({
      repositories: [
        expect.objectContaining({
          repositoryId: 'repository-01',
          availability: 'REPOSITORY_UNAVAILABLE',
        }),
      ],
    })
  })

  it('requires a connected provider and an existing remote repository', async () => {
    const fixture = createFixture()
    fixture.disconnect('GITHUB')
    const disconnected = await addRepository(fixture.app)

    expect(disconnected.status).toBe(422)
    expect(await disconnected.json()).toMatchObject({
      error: { code: 'REPOSITORY_CONNECTION_REQUIRED' },
    })

    const connectedFixture = createFixture()
    connectedFixture.setRepositoryAvailable(false)
    const missing = await addRepository(connectedFixture.app)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      error: {
        code: 'REPOSITORY_REMOTE_NOT_FOUND',
        message: 'Repository could not be found',
      },
    })
  })

  it('deletes a repository immediately and cannot restore it through the legacy undo endpoint', async () => {
    const fixture = createFixture()
    await addRepository(fixture.app)

    const deleted = await fixture.app.request('/api/repositories/repository-01', {
      method: 'DELETE',
    })
    const listedAfterDelete = await fixture.app.request('/api/repositories')
    const undone = await fixture.app.request('/api/deletions/deletion-01/undo', { method: 'POST' })
    const listedAfterUndo = await fixture.app.request('/api/repositories')

    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({
      deletionId: 'deletion-01',
      subject: { type: 'REPOSITORY', id: 'repository-01' },
      deletedAt: '2026-08-21T10:00:00Z',
      undoExpiresAt: '2026-08-21T10:00:10.000Z',
    })
    expect(await listedAfterDelete.json()).toEqual({ repositories: [] })
    expect(undone.status).toBe(404)
    expect(await undone.json()).toEqual({
      error: {
        code: 'DELETION_NOT_FOUND',
        message: 'Deletion was not found',
      },
    })
    expect(await listedAfterUndo.json()).toEqual({ repositories: [] })
  })
})
