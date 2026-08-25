import { afterEach, describe, expect, it } from 'vitest'

import { createRepositoryStore } from '../../src/index.js'
import { createPersistenceFixture } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

describe('SQLite repository store', () => {
  it('round-trips repositories in creation order and enforces unique provider repositories', async () => {
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

    await repositories.add(record)

    await expect(repositories.get('repository-01')).resolves.toEqual(record)
    await expect(repositories.findByRemote('GITHUB', '123')).resolves.toEqual(record)
    await expect(repositories.list()).resolves.toEqual([record])
    await expect(
      repositories.add({ ...record, repositoryId: 'repository-02' }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'PERSISTENCE_CONFLICT' }))
    await expect(
      repositories.stageDeletion({
        deletionId: 'deletion-01',
        subject: { type: 'REPOSITORY', id: 'repository-01' },
        deletedAt: '2026-08-22T10:00:00Z',
        undoExpiresAt: '2026-08-22T10:00:10Z',
      }),
    ).resolves.toBe(true)
    await expect(repositories.get('repository-01')).resolves.toBeUndefined()
    await expect(repositories.restoreDeletion('deletion-01', '2026-08-22T10:00:05Z')).resolves.toBe(
      'UNDONE',
    )
    await expect(repositories.get('repository-01')).resolves.toEqual(record)
    await expect(repositories.restoreDeletion('deletion-01', '2026-08-22T10:00:06Z')).resolves.toBe(
      'UNDONE',
    )
  })

  it('purges an expired repository deletion', async () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const repositories = createRepositoryStore(fixture.database)
    await repositories.add({
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
    await repositories.stageDeletion({
      deletionId: 'deletion-01',
      subject: { type: 'REPOSITORY', id: 'repository-01' },
      deletedAt: '2026-08-22T10:00:00Z',
      undoExpiresAt: '2026-08-22T10:00:10Z',
    })

    await repositories.purgeExpired('2026-08-22T10:00:10Z')

    await expect(repositories.restoreDeletion('deletion-01', '2026-08-22T10:00:10Z')).resolves.toBe(
      'EXPIRED',
    )
    await expect(repositories.findByRemote('GITHUB', '123')).resolves.toBeUndefined()
  })
})
