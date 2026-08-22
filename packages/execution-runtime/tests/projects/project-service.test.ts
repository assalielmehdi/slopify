import { describe, expect, it } from 'vitest'

import {
  ProjectServiceError,
  createProjectService,
  type ProjectInspection,
  type ProjectInspector,
  type ProjectRecord,
  type ProjectRepository,
} from '../../src/index.js'

const createRepository = (): ProjectRepository & { records: ProjectRecord[] } => {
  const records: ProjectRecord[] = []
  const deletions = new Map<
    string,
    {
      record: ProjectRecord
      deletedAt: string
      undoExpiresAt: string
      state: 'PENDING' | 'UNDONE' | 'PURGED'
    }
  >()
  return {
    records,
    add(record) {
      records.push(record)
    },
    get(projectId) {
      return records.find((record) => record.projectId === projectId)
    },
    findByPath(repositoryPath) {
      return records.find((record) => record.repositoryPath === repositoryPath)
    },
    stageDeletion(input) {
      const projectId = input.subject.id
      const index = records.findIndex((record) => record.projectId === projectId)
      if (index === -1) return false
      const [record] = records.splice(index, 1)
      if (record === undefined) return false
      deletions.set(input.deletionId, {
        record,
        deletedAt: input.deletedAt,
        undoExpiresAt: input.undoExpiresAt,
        state: 'PENDING',
      })
      return true
    },
    restoreDeletion(deletionId, now) {
      const deletion = deletions.get(deletionId)
      if (deletion === undefined) return 'NOT_FOUND'
      if (deletion.state === 'UNDONE') return 'UNDONE'
      if (deletion.state === 'PURGED' || Date.parse(deletion.undoExpiresAt) <= Date.parse(now)) {
        deletion.state = 'PURGED'
        return 'EXPIRED'
      }
      deletion.state = 'UNDONE'
      records.push(deletion.record)
      return 'UNDONE'
    },
    purgeExpired(now) {
      for (const deletion of deletions.values()) {
        if (deletion.state === 'PENDING' && Date.parse(deletion.undoExpiresAt) <= Date.parse(now))
          deletion.state = 'PURGED'
      }
    },
    list() {
      return [...records]
    },
  }
}

const createInspector = (inspect: (path: string) => ProjectInspection): ProjectInspector => ({
  inspect: async (path) => inspect(path),
})

const available = (path: string): ProjectInspection => ({
  status: 'AVAILABLE',
  canonicalPath: path,
  name: path.split('/').at(-1) ?? path,
})

describe('project service', () => {
  it('adds a canonical absolute Git repository and lists its live availability', async () => {
    const projects = createRepository()
    const service = createProjectService({
      projects,
      inspector: createInspector((path) => available(path)),
      createId: () => 'project-01',
      now: () => '2026-08-21T10:00:00Z',
    })

    await expect(service.add({ repositoryPath: '/workspace/slopify' })).resolves.toEqual({
      projectId: 'project-01',
      name: 'slopify',
      repositoryPath: '/workspace/slopify',
      availability: 'AVAILABLE',
      createdAt: '2026-08-21T10:00:00Z',
      updatedAt: '2026-08-21T10:00:00Z',
    })
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ projectId: 'project-01', availability: 'AVAILABLE' }),
    ])
  })

  it.each([
    ['relative path', 'workspace/slopify', available('/workspace/slopify'), 'PROJECT_INVALID'],
    [
      'missing path',
      '/workspace/missing',
      { status: 'MISSING' } as const,
      'PROJECT_PATH_NOT_FOUND',
    ],
    [
      'non-Git directory',
      '/workspace/folder',
      { status: 'NOT_GIT_REPOSITORY' } as const,
      'PROJECT_NOT_GIT_REPOSITORY',
    ],
  ])('rejects a %s without persisting it', async (_name, path, inspection, code) => {
    const projects = createRepository()
    const service = createProjectService({
      projects,
      inspector: createInspector(() => inspection),
      createId: () => 'project-01',
    })

    await expect(service.add({ repositoryPath: path })).rejects.toMatchObject({ code })
    expect(projects.records).toEqual([])
  })

  it('rejects a duplicate canonical repository path', async () => {
    const projects = createRepository()
    const service = createProjectService({
      projects,
      inspector: createInspector(() => available('/workspace/slopify')),
      createId: () => `project-0${projects.records.length + 1}`,
    })

    await service.add({ repositoryPath: '/workspace/alias' })
    await expect(service.add({ repositoryPath: '/workspace/slopify' })).rejects.toMatchObject({
      code: 'PROJECT_PATH_CONFLICT',
    })
  })

  it('retains missing projects in the catalog and rejects them for use', async () => {
    const projects = createRepository()
    projects.add({
      projectId: 'project-01',
      name: 'slopify',
      repositoryPath: '/workspace/slopify',
      createdAt: '2026-08-21T10:00:00Z',
      updatedAt: '2026-08-21T10:00:00Z',
    })
    const service = createProjectService({
      projects,
      inspector: createInspector(() => ({ status: 'MISSING' })),
    })

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ projectId: 'project-01', availability: 'MISSING' }),
    ])
    await expect(service.requireAvailable('project-01')).rejects.toBeInstanceOf(ProjectServiceError)
    await expect(service.requireAvailable('project-01')).rejects.toMatchObject({
      code: 'PROJECT_UNAVAILABLE',
    })
  })

  it('stages an existing project for deletion and restores it during the undo window', async () => {
    const projects = createRepository()
    projects.add({
      projectId: 'project-01',
      name: 'slopify',
      repositoryPath: '/workspace/slopify',
      createdAt: '2026-08-21T10:00:00Z',
      updatedAt: '2026-08-21T10:00:00Z',
    })
    const service = createProjectService({
      projects,
      inspector: createInspector((path) => available(path)),
      createDeletionId: () => 'deletion-01',
      now: () => '2026-08-22T10:00:00Z',
    })

    await expect(service.delete('project-01')).resolves.toEqual({
      deletionId: 'deletion-01',
      subject: { type: 'PROJECT', id: 'project-01' },
      deletedAt: '2026-08-22T10:00:00Z',
      undoExpiresAt: '2026-08-22T10:00:10.000Z',
    })
    expect(projects.records).toEqual([])
    await expect(service.undoDeletion('deletion-01')).resolves.toBe('UNDONE')
    expect(projects.records).toHaveLength(1)
    await expect(service.delete('project-missing')).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
    })
  })

  it('rejects undo after the deletion window expires', async () => {
    const projects = createRepository()
    projects.add({
      projectId: 'project-01',
      name: 'slopify',
      repositoryPath: '/workspace/slopify',
      createdAt: '2026-08-21T10:00:00Z',
      updatedAt: '2026-08-21T10:00:00Z',
    })
    let timestamp = '2026-08-22T10:00:00Z'
    const service = createProjectService({
      projects,
      inspector: createInspector((path) => available(path)),
      createDeletionId: () => 'deletion-01',
      now: () => timestamp,
    })

    await service.delete('project-01')
    timestamp = '2026-08-22T10:00:10Z'

    await expect(service.undoDeletion('deletion-01')).resolves.toBe('EXPIRED')
    expect(projects.records).toEqual([])
  })
})
