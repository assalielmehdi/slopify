import { afterEach, describe, expect, it } from 'vitest'

import { createGitConnectionRepository } from '../../src/index.js'
import { createPersistenceFixture } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

describe('SQLite Git connection repository', () => {
  it('upserts and deletes non-secret provider metadata', async () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const connections = createGitConnectionRepository(fixture.database)
    const connection = {
      provider: 'GITHUB' as const,
      accountUsername: 'operator',
      connectedAt: '2026-08-24T00:00:00Z',
      updatedAt: '2026-08-24T00:00:00Z',
    }

    await connections.save(connection)
    await expect(connections.get('GITHUB')).resolves.toEqual(connection)
    await expect(connections.list()).resolves.toEqual([connection])
    await connections.save({
      ...connection,
      accountUsername: 'renamed',
      updatedAt: '2026-08-24T01:00:00Z',
    })
    await expect(connections.get('GITHUB')).resolves.toMatchObject({
      accountUsername: 'renamed',
      connectedAt: connection.connectedAt,
    })
    await expect(connections.delete('GITHUB')).resolves.toBe(true)
    await expect(connections.list()).resolves.toEqual([])
  })
})
