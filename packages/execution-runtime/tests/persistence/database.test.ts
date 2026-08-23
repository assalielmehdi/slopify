import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DatabaseInitializationError,
  openDatabase,
  type WorkbenchDatabase,
} from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'
import {
  CURRENT_SCHEMA_MARKER,
  SLOPIFY_DATABASE_APPLICATION_ID,
} from '../../src/persistence/schema.js'
import { Database } from '../../src/persistence/sqlite.js'

const directories: string[] = []
const databases: WorkbenchDatabase[] = []

const createDatabasePath = (): string => {
  const directory = join(tmpdir(), `slopify-database-${crypto.randomUUID()}`)
  directories.push(directory)
  mkdirSync(directory, { recursive: true })
  return join(directory, 'state.sqlite')
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('current database schema', () => {
  it('initializes only the current tables and fixed ownership markers', () => {
    const database = openDatabase({ path: createDatabasePath() })
    databases.push(database)
    const connection = getDatabaseHandle(database)

    expect(
      connection
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .pluck()
        .all(),
    ).toEqual([
      'deletion_operations',
      'execution_messages',
      'node_executions',
      'projects',
      'run_events',
      'run_project_worktrees',
      'run_projects',
      'runs',
      'schema_metadata',
      'workflow_coordinator_states',
      'workflows',
    ])
    expect(connection.pragma('application_id', { simple: true })).toBe(
      SLOPIFY_DATABASE_APPLICATION_ID,
    )
    expect(connection.prepare('SELECT version, name FROM schema_metadata').get()).toEqual(
      CURRENT_SCHEMA_MARKER,
    )
    expect(database.status()).toEqual({
      foreignKeysEnabled: true,
      journalMode: 'wal',
      schemaVersion: CURRENT_SCHEMA_MARKER.version,
      writable: true,
    })
    expect(
      connection
        .prepare('PRAGMA table_info(node_executions)')
        .all()
        .map((column) => {
          const value = column as { name: string; notnull: number }
          return { name: value.name, required: value.notnull === 1 }
        }),
    ).toEqual([
      { name: 'node_execution_id', required: true },
      { name: 'run_id', required: true },
      { name: 'node_id', required: true },
      { name: 'execution_index', required: true },
      { name: 'attempt_id', required: true },
      { name: 'status', required: true },
      { name: 'output_json', required: false },
      { name: 'outcome', required: false },
      { name: 'error_code', required: false },
      { name: 'error_message', required: false },
      { name: 'started_at', required: false },
      { name: 'completed_at', required: false },
      { name: 'duration_ms', required: false },
    ])
  })

  it('reopens the current schema idempotently without replacing data', () => {
    const path = createDatabasePath()
    const first = openDatabase({ path })
    getDatabaseHandle(first)
      .prepare(
        `INSERT INTO workflows (workflow_id, definition_json)
         VALUES ('workflow-01', '{"name":"Workflow"}')`,
      )
      .run()
    first.close()

    const reopened = openDatabase({ path })
    databases.push(reopened)
    expect(
      getDatabaseHandle(reopened)
        .prepare(
          "SELECT json_extract(definition_json, '$.name') FROM workflows WHERE workflow_id = ?",
        )
        .pluck()
        .get('workflow-01'),
    ).toBe('Workflow')
    expect(
      getDatabaseHandle(reopened).prepare('SELECT COUNT(*) FROM schema_metadata').pluck().get(),
    ).toBe(1)
  })

  it('rejects an unmarked non-empty database and preserves it byte-for-byte', () => {
    const path = createDatabasePath()
    const custom = new Database(path)
    custom.exec(`CREATE TABLE custom_data (value TEXT NOT NULL) STRICT`)
    custom.prepare('INSERT INTO custom_data (value) VALUES (?)').run('keep me')
    custom.close()
    const before = readFileSync(path)

    expect(() => openDatabase({ path })).toThrowError(
      expect.objectContaining({
        code: 'DATABASE_SCHEMA_INCOMPATIBLE',
        databasePath: path,
      }) satisfies Partial<DatabaseInitializationError>,
    )

    expect(readFileSync(path)).toEqual(before)
    const preserved = new Database(path, { readonly: true })
    expect(preserved.prepare('SELECT value FROM custom_data').pluck().get()).toBe('keep me')
    expect(preserved.pragma('application_id', { simple: true })).toBe(0)
    preserved.close()
  })

  it('rejects a database carrying a different application id without changing it', () => {
    const path = createDatabasePath()
    const custom = new Database(path)
    custom.exec('CREATE TABLE custom_data (value TEXT NOT NULL) STRICT')
    custom.pragma('application_id = 123456')
    custom.close()

    expect(() => openDatabase({ path })).toThrowError(
      expect.objectContaining({ code: 'DATABASE_SCHEMA_INCOMPATIBLE' }),
    )

    const preserved = new Database(path, { readonly: true })
    expect(preserved.pragma('application_id', { simple: true })).toBe(123456)
    expect(
      preserved
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
        .pluck()
        .all(),
    ).toEqual(['custom_data'])
    preserved.close()
  })

  it('rejects a Slopify-marked database with a different schema marker', () => {
    const path = createDatabasePath()
    const current = openDatabase({ path })
    getDatabaseHandle(current)
      .prepare('UPDATE schema_metadata SET name = ? WHERE version = ?')
      .run('different_schema', CURRENT_SCHEMA_MARKER.version)
    current.close()
    const before = readFileSync(path)

    expect(() => openDatabase({ path })).toThrowError(
      expect.objectContaining({ code: 'DATABASE_SCHEMA_INCOMPATIBLE' }),
    )

    expect(readFileSync(path)).toEqual(before)
  })

  it('rejects memory and blank paths before opening a database', () => {
    for (const path of ['', '   ', ':memory:']) {
      expect(() => openDatabase({ path })).toThrowError(
        expect.objectContaining({ code: 'DATABASE_PATH_INVALID' }),
      )
    }
  })
})
