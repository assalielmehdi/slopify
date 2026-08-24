import { afterEach, describe, expect, it } from 'vitest'

import { createGitConnectionRepository } from '../../src/index.js'
import { createPersistenceFixture } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

describe('SQLite Git connection repository', () => {
  it('upserts and deletes non-secret provider metadata', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const connections = createGitConnectionRepository(fixture.database)
    const connection = {
      provider: 'GITHUB' as const,
      accountUsername: 'operator',
      connectedAt: '2026-08-24T00:00:00Z',
      updatedAt: '2026-08-24T00:00:00Z',
    }

    connections.save(connection)
    expect(connections.get('GITHUB')).toEqual(connection)
    expect(connections.list()).toEqual([connection])
    connections.save({
      ...connection,
      accountUsername: 'renamed',
      updatedAt: '2026-08-24T01:00:00Z',
    })
    expect(connections.get('GITHUB')).toMatchObject({
      accountUsername: 'renamed',
      connectedAt: connection.connectedAt,
    })
    expect(connections.delete('GITHUB')).toBe(true)
    expect(connections.list()).toEqual([])
  })
})
