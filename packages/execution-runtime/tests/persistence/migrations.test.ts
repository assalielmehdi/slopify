import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { openDatabase, type WorkbenchDatabase } from '../../src/index.js'
import { applyMigrations, type Migration } from '../../src/persistence/migrations.js'

const openedDatabases: WorkbenchDatabase[] = []
const rawDatabases: Database.Database[] = []
const temporaryDirectories: string[] = []

const createDatabasePath = (): string => {
  const directory = join(tmpdir(), `slopify-migrations-${crypto.randomUUID()}`)
  temporaryDirectories.push(directory)
  const path = join(directory, 'state', 'workbench.sqlite')
  mkdirSync(dirname(path), { recursive: true })
  return path
}

afterEach(() => {
  for (const database of openedDatabases.splice(0)) {
    if (database.isOpen) database.close()
  }

  for (const database of rawDatabases.splice(0)) {
    if (database.open) database.close()
  }

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('forward-only migrations', () => {
  it('records each migration once when a database is reopened', () => {
    const path = createDatabasePath()
    const database = openDatabase({ path })
    database.close()

    const reopened = openDatabase({ path })
    openedDatabases.push(reopened)
    const raw = new Database(path, { readonly: true })
    rawDatabases.push(raw)

    expect(
      raw.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all(),
    ).toEqual([
      { version: 1, name: 'create_execution_schema' },
      { version: 2, name: 'persist_complete_repository_selection' },
      { version: 3, name: 'persist_optional_run_notes' },
      { version: 4, name: 'persist_connection_metadata' },
      { version: 5, name: 'create_durable_execution_queue' },
      { version: 6, name: 'persist_workflow_coordinator_state' },
      { version: 7, name: 'persist_node_attempt_identity' },
    ])
  })

  it('rolls back a failed migration without recording its version', () => {
    const raw = new Database(createDatabasePath())
    rawDatabases.push(raw)
    const failingMigration: Migration = {
      version: 1,
      name: 'failing_migration',
      up(database) {
        database.exec('CREATE TABLE should_roll_back (id INTEGER PRIMARY KEY)')
        throw new Error('planned migration failure')
      },
    }

    expect(() => applyMigrations(raw, [failingMigration])).toThrow('planned migration failure')
    expect(
      raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_roll_back'",
        )
        .get(),
    ).toBeUndefined()
    expect(raw.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(0)
  })

  it('rejects changed metadata for an already-applied migration', () => {
    const raw = new Database(createDatabasePath())
    rawDatabases.push(raw)
    const initial: Migration = {
      version: 1,
      name: 'initial',
      up(database) {
        database.exec('CREATE TABLE durable_record (id INTEGER PRIMARY KEY)')
      },
    }

    applyMigrations(raw, [initial])

    expect(() => applyMigrations(raw, [{ ...initial, name: 'renamed' }])).toThrow(
      /metadata does not match/i,
    )
  })
})
