import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createConnectionCatalogRepository,
  openDatabase,
  type WorkbenchDatabase,
} from '../../src/index.js'

const databases: WorkbenchDatabase[] = []
const roots: string[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('SQLite connection catalog', () => {
  it('loads the supported providers and connectors from seeded database rows', () => {
    const root = join(tmpdir(), `slopify-connection-catalog-${crypto.randomUUID()}`)
    roots.push(root)
    const database = openDatabase({ path: join(root, 'state.sqlite') })
    databases.push(database)

    expect(createConnectionCatalogRepository(database).list()).toEqual([
      expect.objectContaining({
        type: 'gitlab',
        category: 'connector',
        name: 'GitLab',
        skillId: 'gitlab-connector',
      }),
      expect.objectContaining({
        type: 'clickup',
        category: 'connector',
        name: 'ClickUp',
        skillId: 'clickup-connector',
      }),
      expect.objectContaining({ type: 'openrouter', category: 'inference', name: 'OpenRouter' }),
      expect.objectContaining({
        type: 'chatgpt-subscription',
        category: 'inference',
        name: 'ChatGPT',
        models: expect.arrayContaining([
          expect.objectContaining({
            id: 'gpt-5.6-luna',
            thinkingLevels: expect.arrayContaining(['low', 'medium', 'high', 'max']),
          }),
        ]),
      }),
    ])
  })
})
