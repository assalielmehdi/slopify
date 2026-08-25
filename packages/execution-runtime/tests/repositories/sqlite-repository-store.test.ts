import { afterEach, describe, expect, it } from 'vitest'

import { createRepositoryStore } from '../../src/index.js'
import { createPersistenceFixture } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

describe('SQLite repository store', () => {
  it('round-trips repositories in creation order and enforces unique provider repositories', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const repositories = createRepositoryStore(fixture.database)
    const record = {
      repositoryId: 'repository-01',
      name: 'slopify',
      provider: 'GITHUB' as const,
      remoteId: '123',
      fullName: 'operator/slopify',
      cloneUrl: 'https://github.com/operator/slopify.git',
      webUrl: 'https://github.com/operator/slopify',
      defaultBranch: 'main',
      createdAt: '2026-08-21T10:00:00Z',
      updatedAt: '2026-08-21T10:00:00Z',
    }

    repositories.add(record)

    expect(repositories.get('repository-01')).toEqual(record)
    expect(repositories.findByRemote('GITHUB', '123')).toEqual(record)
    expect(repositories.list()).toEqual([record])
    expect(() => repositories.add({ ...record, repositoryId: 'repository-02' })).toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_CONFLICT' }),
    )
    expect(
      repositories.stageDeletion({
        deletionId: 'deletion-01',
        subject: { type: 'REPOSITORY', id: 'repository-01' },
        deletedAt: '2026-08-22T10:00:00Z',
        undoExpiresAt: '2026-08-22T10:00:10Z',
      }),
    ).toBe(true)
    expect(repositories.get('repository-01')).toBeUndefined()
    expect(repositories.restoreDeletion('deletion-01', '2026-08-22T10:00:05Z')).toBe('UNDONE')
    expect(repositories.get('repository-01')).toEqual(record)
    expect(repositories.restoreDeletion('deletion-01', '2026-08-22T10:00:06Z')).toBe('UNDONE')
  })

  it('purges an expired repository deletion', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const repositories = createRepositoryStore(fixture.database)
    repositories.add({
      repositoryId: 'repository-01',
      name: 'slopify',
      provider: 'GITHUB',
      remoteId: '123',
      fullName: 'operator/slopify',
      cloneUrl: 'https://github.com/operator/slopify.git',
      webUrl: 'https://github.com/operator/slopify',
      defaultBranch: 'main',
      createdAt: '2026-08-21T10:00:00Z',
      updatedAt: '2026-08-21T10:00:00Z',
    })
    repositories.stageDeletion({
      deletionId: 'deletion-01',
      subject: { type: 'REPOSITORY', id: 'repository-01' },
      deletedAt: '2026-08-22T10:00:00Z',
      undoExpiresAt: '2026-08-22T10:00:10Z',
    })

    repositories.purgeExpired('2026-08-22T10:00:10Z')

    expect(repositories.restoreDeletion('deletion-01', '2026-08-22T10:00:10Z')).toBe('EXPIRED')
    expect(repositories.findByRemote('GITHUB', '123')).toBeUndefined()
  })
})
