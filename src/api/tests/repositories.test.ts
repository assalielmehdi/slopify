import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GitProvider, GitRepository } from '@slopify/shared'
import {
  createFilesystemRepositoryStore,
  GitConnectionServiceError,
  createRepositoryService,
  resolveSlopifyPaths,
  type RemoteGitHost,
} from '../src/index.js'
import { afterEach, describe, expect, it } from 'vitest'

import { createTestAgentWorkflow } from '../../../src/api/tests/support/runtime-fixture.js'
import { createApiApp } from '../src/app.js'

const directories: string[] = []

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
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

const createFixture = () => {
  const workflow = createTestAgentWorkflow({
    repositoryIds: ['repository-01'],
    primaryRepositoryId: 'repository-01',
  })
  const home = mkdtempSync(join(tmpdir(), 'slopify-api-repositories-'))
  directories.push(home)
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
    repositories: createFilesystemRepositoryStore({
      paths: resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } }),
    }),
    connections: {
      requireToken: async (provider) => {
        if (connected.has(provider)) return 'token'
        throw new GitConnectionServiceError('GIT_CONNECTION_NOT_FOUND', 'Provider not connected')
      },
    },
    remote,
    createId: () => 'repository-01',
    now: () => timestamp,
  })
  return {
    app: createApiApp({ repositories }),
    disconnect(provider: GitProvider) {
      connected.delete(provider)
    },
    setRepositoryAvailable(available: boolean) {
      repositoryAvailable = available
    },
    getWorkflow: () => workflow,
  }
}

const addRepository = (app: ReturnType<typeof createApiApp>) =>
  app.request('/api/repositories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'GITHUB', remoteId: '123' }),
  })

describe('repositories API', () => {
  it('reuses the inspected availability after adding a connected remote repository', async () => {
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
          availability: 'AVAILABLE',
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

  it('deletes a repository immediately without exposing an undo endpoint', async () => {
    const fixture = createFixture()
    await addRepository(fixture.app)

    const deleted = await fixture.app.request('/api/repositories/repository-01', {
      method: 'DELETE',
    })
    const listedAfterDelete = await fixture.app.request('/api/repositories')
    const undone = await fixture.app.request('/api/deletions/deletion-01/undo', { method: 'POST' })

    expect(deleted.status).toBe(204)
    expect(await deleted.text()).toBe('')
    expect(await listedAfterDelete.json()).toEqual({ repositories: [] })
    expect(undone.status).toBe(404)
    expect(await undone.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    })
    expect(fixture.getWorkflow()?.configuration).toEqual({
      repositoryIds: ['repository-01'],
      primaryRepositoryId: 'repository-01',
      variables: [],
    })
  })
})
