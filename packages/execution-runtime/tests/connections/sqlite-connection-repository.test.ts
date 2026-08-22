import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createConnectionRepository,
  openDatabase,
  type ConnectionRecord,
  type WorkbenchDatabase,
} from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'

const databases: WorkbenchDatabase[] = []
const roots: string[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const fixture = () => {
  const root = join(tmpdir(), `slopify-connections-${crypto.randomUUID()}`)
  roots.push(root)
  const database = openDatabase({ path: join(root, 'state.sqlite') })
  databases.push(database)
  return { database, repository: createConnectionRepository(database) }
}

const RECORD: ConnectionRecord = {
  connectionId: 'gitlab-primary',
  type: 'gitlab',
  category: 'connector',
  label: 'Primary GitLab',
  authority: 'Read and write GitLab resources available to the connected user.',
  configuration: { baseUrl: 'https://gitlab.com' },
  metadata: { identity: { username: 'operator' }, scopes: ['api'] },
  status: 'CONNECTED',
  validatedAt: '2026-08-20T00:00:00.000Z',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
}

describe('SQLite connection repository', () => {
  it('persists only non-secret connection metadata', () => {
    const { database, repository } = fixture()
    repository.save(RECORD)

    expect(repository.get(RECORD.connectionId)).toEqual(RECORD)
    expect(repository.list()).toEqual([RECORD])
    const columns = getDatabaseHandle(database).pragma('table_info(connections)') as {
      name: string
    }[]
    expect(columns.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(['credential', 'secret', 'token', 'api_key']),
    )
  })

  it('updates metadata and deletes independently from credentials', () => {
    const { repository } = fixture()
    repository.save(RECORD)
    repository.save({ ...RECORD, label: 'Renamed', updatedAt: '2026-08-20T01:00:00.000Z' })
    expect(repository.get(RECORD.connectionId)).toMatchObject({ label: 'Renamed' })
    repository.delete(RECORD.connectionId)
    expect(repository.get(RECORD.connectionId)).toBeUndefined()
  })

  it('enforces one connection record per supported type', () => {
    const { repository } = fixture()
    repository.save(RECORD)

    expect(() => repository.save({ ...RECORD, connectionId: 'gitlab-secondary' })).toThrow()
  })
})
