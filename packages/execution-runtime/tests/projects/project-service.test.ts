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
    delete(projectId) {
      const index = records.findIndex((record) => record.projectId === projectId)
      if (index === -1) return false
      records.splice(index, 1)
      return true
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

  it('deletes an existing project and rejects an unknown project', async () => {
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
    })

    await expect(service.delete('project-01')).resolves.toBeUndefined()
    expect(projects.records).toEqual([])
    await expect(service.delete('project-01')).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
    })
  })
})
