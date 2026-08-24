import type { GitProvider, GitRepository } from '@slopify/contracts'
import { describe, expect, it } from 'vitest'

import {
  GitConnectionServiceError,
  ProjectServiceError,
  createProjectService,
  type GitConnectionService,
  type ProjectRecord,
  type ProjectRepository,
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

const storedProject = (): ProjectRecord => ({
  projectId: 'project-01',
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

const createRepository = (): ProjectRepository & { records: ProjectRecord[] } => {
  const records: ProjectRecord[] = []
  const deleted = new Map<string, ProjectRecord>()
  return {
    records,
    add: (record) => void records.push(record),
    get: (projectId) => records.find((record) => record.projectId === projectId),
    findByRemote: (provider, remoteId) =>
      records.find((record) => record.provider === provider && record.remoteId === remoteId),
    list: () => [...records],
    stageDeletion(input) {
      const index = records.findIndex(({ projectId }) => projectId === input.subject.id)
      if (index < 0) return false
      const [record] = records.splice(index, 1)
      if (record === undefined) return false
      deleted.set(input.deletionId, record)
      return true
    },
    restoreDeletion(deletionId) {
      const record = deleted.get(deletionId)
      if (record === undefined) return 'NOT_FOUND'
      records.push(record)
      deleted.delete(deletionId)
      return 'UNDONE'
    },
    purgeExpired: () => undefined,
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

describe('project service', () => {
  it('adds a repository from a connected provider and lists its live availability', async () => {
    const projects = createRepository()
    const service = createProjectService({
      projects,
      connections: createConnections(),
      remote: createRemote(),
      createId: () => 'project-01',
      now: () => '2026-08-21T10:00:00Z',
    })

    await expect(service.add({ provider: 'GITHUB', remoteId: '123' })).resolves.toEqual({
      projectId: 'project-01',
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
      expect.objectContaining({ projectId: 'project-01', availability: 'AVAILABLE' }),
    ])
  })

  it('requires a configured provider and an existing remote repository', async () => {
    const projects = createRepository()
    const disconnected = createProjectService({
      projects,
      connections: createConnections(new Map()),
      remote: createRemote(),
    })
    await expect(disconnected.add({ provider: 'GITHUB', remoteId: '123' })).rejects.toMatchObject({
      code: 'PROJECT_CONNECTION_REQUIRED',
    })

    const missing = createProjectService({
      projects,
      connections: createConnections(),
      remote: createRemote(undefined),
    })
    await expect(missing.add({ provider: 'GITHUB', remoteId: '404' })).rejects.toMatchObject({
      code: 'PROJECT_REPOSITORY_NOT_FOUND',
    })
    expect(projects.records).toEqual([])
  })

  it('rejects a duplicate provider repository', async () => {
    const projects = createRepository()
    const service = createProjectService({
      projects,
      connections: createConnections(),
      remote: createRemote(),
      createId: () => `project-0${projects.records.length + 1}`,
    })

    await service.add({ provider: 'GITHUB', remoteId: '123' })
    await expect(service.add({ provider: 'GITHUB', remoteId: '123' })).rejects.toMatchObject({
      code: 'PROJECT_REMOTE_CONFLICT',
    })
  })

  it('retains projects when their provider disconnects and rejects them for run admission', async () => {
    const projects = createRepository()
    projects.add(storedProject())
    const service = createProjectService({
      projects,
      connections: createConnections(new Map()),
      remote: createRemote(),
    })

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ availability: 'CONNECTION_MISSING' }),
    ])
    await expect(service.requireAvailable('project-01')).rejects.toBeInstanceOf(ProjectServiceError)
    await expect(service.requireAvailable('project-01')).rejects.toMatchObject({
      code: 'PROJECT_UNAVAILABLE',
    })
  })

  it('uses current remote metadata when a repository is renamed', async () => {
    const projects = createRepository()
    projects.add(storedProject())
    const renamedRepository: GitRepository = {
      ...remoteRepository,
      name: 'renamed',
      fullName: 'operator/renamed',
      cloneUrl: 'https://github.com/operator/renamed.git',
      webUrl: 'https://github.com/operator/renamed',
      defaultBranch: 'trunk',
    }
    const service = createProjectService({
      projects,
      connections: createConnections(),
      remote: createRemote(renamedRepository),
    })

    await expect(service.requireAvailable('project-01')).resolves.toMatchObject({
      name: 'renamed',
      fullName: 'operator/renamed',
      cloneUrl: 'https://github.com/operator/renamed.git',
      webUrl: 'https://github.com/operator/renamed',
      defaultBranch: 'trunk',
      availability: 'AVAILABLE',
    })
  })

  it('stages and restores project deletion', async () => {
    const projects = createRepository()
    projects.add(storedProject())
    const service = createProjectService({
      projects,
      connections: createConnections(),
      remote: createRemote(),
      createDeletionId: () => 'deletion-01',
      now: () => '2026-08-22T10:00:00Z',
    })

    await expect(service.delete('project-01')).resolves.toMatchObject({
      deletionId: 'deletion-01',
      subject: { type: 'PROJECT', id: 'project-01' },
    })
    await expect(service.undoDeletion('deletion-01')).resolves.toBe('UNDONE')
    expect(projects.records).toHaveLength(1)
  })
})
