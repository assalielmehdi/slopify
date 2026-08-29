import type { GitProvider, GitRepository } from '@slopify/shared'
import { describe, expect, it, vi } from 'vitest'

import {
  GitConnectionServiceError,
  RepositoryServiceError,
  RepositoryStoreError,
  createRepositoryService,
  type GitConnectionService,
  type RepositoryRecord,
  type RepositoryStore,
  type RemoteGitHost,
} from '../../src/index.js'

const remoteRepository: GitRepository = {
  provider: 'GITHUB',
  remoteId: '123',
  name: 'slopify',
  fullName: 'operator/slopify',
  cloneUrl: 'https://github.com/operator/slopify.git',
  webUrl: 'https://github.com/operator/slopify',
  visibility: 'PRIVATE',
  defaultBranch: 'main',
}

const storedRepository = (): RepositoryRecord => ({
  repositoryId: 'repository-01',
  name: remoteRepository.name,
  provider: remoteRepository.provider,
  remoteId: remoteRepository.remoteId,
  fullName: remoteRepository.fullName,
  cloneUrl: remoteRepository.cloneUrl,
  webUrl: remoteRepository.webUrl,
  defaultBranch: remoteRepository.defaultBranch,
  createdAt: '2026-08-21T10:00:00Z',
  updatedAt: '2026-08-21T10:00:00Z',
})

const createRepository = (): RepositoryStore & { records: RepositoryRecord[] } => {
  const records: RepositoryRecord[] = []
  return {
    records,
    async add(record) {
      records.push(record)
    },
    async get(repositoryId) {
      return records.find((record) => record.repositoryId === repositoryId)
    },
    async findByRemote(provider, remoteId) {
      return records.find((record) => record.provider === provider && record.remoteId === remoteId)
    },
    async list() {
      return [...records]
    },
    async delete(repositoryId) {
      const index = records.findIndex((record) => record.repositoryId === repositoryId)
      if (index < 0) return false
      records.splice(index, 1)
      return true
    },
  }
}

const createConnections = (tokens = new Map<GitProvider, string>([['GITHUB', 'token']])) =>
  ({
    requireToken: async (provider: GitProvider) => {
      const token = tokens.get(provider)
      if (token === undefined) {
        throw new GitConnectionServiceError('GIT_CONNECTION_NOT_FOUND', 'Provider not connected')
      }
      return token
    },
  }) as Pick<GitConnectionService, 'requireToken'>

const createRemote = (repository: GitRepository | undefined = remoteRepository): RemoteGitHost => ({
  authenticate: async (provider) => ({ provider, accountUsername: 'operator' }),
  listRepositories: async () => (repository === undefined ? [] : [repository]),
  getRepository: async (_provider, _token, remoteId) =>
    repository?.remoteId === remoteId ? repository : undefined,
  getDefaultBranchSha: async () => 'a'.repeat(40) as never,
})

describe('repository service', () => {
  it('adds a repository from a connected provider and lists its live availability', async () => {
    const repositories = createRepository()
    const service = createRepositoryService({
      repositories,
      connections: createConnections(),
      remote: createRemote(),
      createId: () => 'repository-01',
      now: () => '2026-08-21T10:00:00Z',
    })

    await expect(service.add({ provider: 'GITHUB', remoteId: '123' })).resolves.toEqual({
      repositoryId: 'repository-01',
      name: 'slopify',
      provider: 'GITHUB',
      remoteId: '123',
      fullName: 'operator/slopify',
      cloneUrl: 'https://github.com/operator/slopify.git',
      webUrl: 'https://github.com/operator/slopify',
      defaultBranch: 'main',
      availability: 'AVAILABLE',
      createdAt: '2026-08-21T10:00:00Z',
      updatedAt: '2026-08-21T10:00:00Z',
    })
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ repositoryId: 'repository-01', availability: 'AVAILABLE' }),
    ])
  })

  it('requires a configured provider and an existing remote repository', async () => {
    const repositories = createRepository()
    const disconnected = createRepositoryService({
      repositories,
      connections: createConnections(new Map()),
      remote: createRemote(),
    })
    await expect(disconnected.add({ provider: 'GITHUB', remoteId: '123' })).rejects.toMatchObject({
      code: 'REPOSITORY_CONNECTION_REQUIRED',
    })

    const missing = createRepositoryService({
      repositories,
      connections: createConnections(),
      remote: createRemote(undefined),
    })
    await expect(missing.add({ provider: 'GITHUB', remoteId: '404' })).rejects.toMatchObject({
      code: 'REPOSITORY_REMOTE_NOT_FOUND',
    })
    expect(repositories.records).toEqual([])
  })

  it('rejects a duplicate provider repository', async () => {
    const repositories = createRepository()
    const service = createRepositoryService({
      repositories,
      connections: createConnections(),
      remote: createRemote(),
      createId: () => `repository-0${repositories.records.length + 1}`,
    })

    await service.add({ provider: 'GITHUB', remoteId: '123' })
    await expect(service.add({ provider: 'GITHUB', remoteId: '123' })).rejects.toMatchObject({
      code: 'REPOSITORY_REMOTE_CONFLICT',
    })
  })

  it('maps an atomic store collision to the stable duplicate repository error', async () => {
    const repositories = createRepository()
    repositories.add = vi.fn(async () => {
      throw new RepositoryStoreError('REPOSITORY_CONFLICT', 'Repository already exists')
    })
    const service = createRepositoryService({
      repositories,
      connections: createConnections(),
      remote: createRemote(),
    })

    await expect(service.add({ provider: 'GITHUB', remoteId: '123' })).rejects.toMatchObject({
      code: 'REPOSITORY_REMOTE_CONFLICT',
    })
  })

  it('retains repositories when their provider disconnects and rejects them for run admission', async () => {
    const repositories = createRepository()
    await repositories.add(storedRepository())
    const service = createRepositoryService({
      repositories,
      connections: createConnections(new Map()),
      remote: createRemote(),
    })

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ availability: 'CONNECTION_MISSING' }),
    ])
    await expect(service.requireAvailable('repository-01')).rejects.toBeInstanceOf(
      RepositoryServiceError,
    )
    await expect(service.requireAvailable('repository-01')).rejects.toMatchObject({
      code: 'REPOSITORY_UNAVAILABLE',
    })
  })

  it('uses current remote metadata when a repository is renamed', async () => {
    const repositories = createRepository()
    await repositories.add(storedRepository())
    const renamedRepository: GitRepository = {
      ...remoteRepository,
      name: 'renamed',
      fullName: 'operator/renamed',
      cloneUrl: 'https://github.com/operator/renamed.git',
      webUrl: 'https://github.com/operator/renamed',
      defaultBranch: 'trunk',
    }
    const service = createRepositoryService({
      repositories,
      connections: createConnections(),
      remote: createRemote(renamedRepository),
    })

    await expect(service.requireAvailable('repository-01')).resolves.toMatchObject({
      name: 'renamed',
      fullName: 'operator/renamed',
      cloneUrl: 'https://github.com/operator/renamed.git',
      webUrl: 'https://github.com/operator/renamed',
      defaultBranch: 'trunk',
      availability: 'AVAILABLE',
    })
  })

  it('caches repository discovery and shares concurrent remote inspections', async () => {
    const repositories = createRepository()
    await repositories.add(storedRepository())
    const remote = createRemote()
    const getRepository = vi.fn(remote.getRepository)
    const service = createRepositoryService({
      repositories,
      connections: createConnections(),
      remote: { ...remote, getRepository },
    })

    await expect(Promise.all([service.list(), service.list()])).resolves.toHaveLength(2)
    await service.list()
    expect(getRepository).toHaveBeenCalledTimes(1)
  })

  it('bypasses cached metadata when run admission requests a fresh repository', async () => {
    const repositories = createRepository()
    await repositories.add(storedRepository())
    let current = remoteRepository
    const remote = createRemote()
    const getRepository = vi.fn(async () => current)
    const service = createRepositoryService({
      repositories,
      connections: createConnections(),
      remote: { ...remote, getRepository },
    })

    await service.list()
    current = { ...remoteRepository, defaultBranch: 'trunk' }

    await expect(service.requireAvailable('repository-01', { fresh: true })).resolves.toMatchObject(
      {
        defaultBranch: 'trunk',
      },
    )
    expect(getRepository).toHaveBeenCalledTimes(2)
  })

  it('keeps the newest inspection single-flight when its stored record changes', async () => {
    const repositories = createRepository()
    await repositories.add(storedRepository())
    const listRecords = vi.spyOn(repositories, 'list')
    let resolveFirst: (repository: GitRepository | undefined) => void = () => undefined
    let resolveSecond: (repository: GitRepository | undefined) => void = () => undefined
    const getRepository = vi
      .fn<RemoteGitHost['getRepository']>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)))
    const service = createRepositoryService({
      repositories,
      connections: createConnections(),
      remote: { ...createRemote(), getRepository },
    })

    const first = service.list()
    await vi.waitFor(() => expect(getRepository).toHaveBeenCalledTimes(1))
    repositories.records[0] = {
      ...storedRepository(),
      updatedAt: '2026-08-21T10:01:00Z',
    }
    const second = service.list()
    await vi.waitFor(() => expect(getRepository).toHaveBeenCalledTimes(2))

    resolveFirst(remoteRepository)
    await first
    const third = service.list()
    await vi.waitFor(() => expect(listRecords).toHaveBeenCalledTimes(3))
    await Promise.resolve()
    await Promise.resolve()

    expect(getRepository).toHaveBeenCalledTimes(2)
    resolveSecond(remoteRepository)
    await expect(Promise.all([second, third])).resolves.toHaveLength(2)
  })

  it('immediately deletes a repository', async () => {
    const repositories = createRepository()
    await repositories.add(storedRepository())
    const service = createRepositoryService({
      repositories,
      connections: createConnections(),
      remote: createRemote(),
    })

    await expect(service.delete('repository-01')).resolves.toBeUndefined()
    expect(repositories.records).toEqual([])
  })
})
