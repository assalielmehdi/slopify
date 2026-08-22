import { afterEach, describe, expect, it } from 'vitest'

import { createProjectRepository } from '../../src/index.js'
import { createPersistenceFixture } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

describe('SQLite project repository', () => {
  it('round-trips projects in creation order and enforces unique paths', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const projects = createProjectRepository(fixture.database)
    const record = {
      projectId: 'project-01',
      name: 'slopify',
      repositoryPath: '/workspace/slopify',
      createdAt: '2026-08-21T10:00:00Z',
      updatedAt: '2026-08-21T10:00:00Z',
    }

    projects.add(record)

    expect(projects.get('project-01')).toEqual(record)
    expect(projects.findByPath('/workspace/slopify')).toEqual(record)
    expect(projects.list()).toEqual([record])
    expect(() => projects.add({ ...record, projectId: 'project-02' })).toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_CONFLICT' }),
    )
    expect(
      projects.stageDeletion({
        deletionId: 'deletion-01',
        subject: { type: 'PROJECT', id: 'project-01' },
        deletedAt: '2026-08-22T10:00:00Z',
        undoExpiresAt: '2026-08-22T10:00:10Z',
      }),
    ).toBe(true)
    expect(projects.get('project-01')).toBeUndefined()
    expect(projects.restoreDeletion('deletion-01', '2026-08-22T10:00:05Z')).toBe('UNDONE')
    expect(projects.get('project-01')).toEqual(record)
    expect(projects.restoreDeletion('deletion-01', '2026-08-22T10:00:06Z')).toBe('UNDONE')
  })

  it('purges an expired project deletion', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const projects = createProjectRepository(fixture.database)
    projects.add({
      projectId: 'project-01',
      name: 'slopify',
      repositoryPath: '/workspace/slopify',
      createdAt: '2026-08-21T10:00:00Z',
      updatedAt: '2026-08-21T10:00:00Z',
    })
    projects.stageDeletion({
      deletionId: 'deletion-01',
      subject: { type: 'PROJECT', id: 'project-01' },
      deletedAt: '2026-08-22T10:00:00Z',
      undoExpiresAt: '2026-08-22T10:00:10Z',
    })

    projects.purgeExpired('2026-08-22T10:00:10Z')

    expect(projects.restoreDeletion('deletion-01', '2026-08-22T10:00:10Z')).toBe('EXPIRED')
    expect(projects.findByPath('/workspace/slopify')).toBeUndefined()
  })
})
