import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { DatabaseSchemaIncompatibleError, initializeCurrentSchema } from './schema.js'
import { Database } from './sqlite.js'

export type DatabaseInitializationErrorCode =
  | 'DATABASE_PATH_INVALID'
  | 'DATABASE_OPEN_FAILED'
  | 'DATABASE_CONFIGURATION_FAILED'
  | 'DATABASE_SCHEMA_INCOMPATIBLE'
  | 'DATABASE_SCHEMA_INITIALIZATION_FAILED'
  | 'DATABASE_NOT_WRITABLE'

export class DatabaseInitializationError extends Error {
  readonly code: DatabaseInitializationErrorCode
  readonly databasePath: string

  constructor(input: {
    readonly code: DatabaseInitializationErrorCode
    readonly databasePath: string
    readonly message: string
    readonly cause?: unknown
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'DatabaseInitializationError'
    this.code = input.code
    this.databasePath = input.databasePath
  }
}

export interface DatabaseStatus {
  readonly foreignKeysEnabled: boolean
  readonly journalMode: string
  readonly schemaVersion: number
  readonly writable: boolean
}

export interface WorkbenchDatabase {
  readonly path: string
  readonly isOpen: boolean
  status(): DatabaseStatus
  close(): void
}

export interface OpenDatabaseOptions {
  readonly path: string
}

const databaseHandles = new WeakMap<WorkbenchDatabase, Database>()

const readSchemaVersion = (database: Database): number => {
  const version = database
    .prepare('SELECT COALESCE(MAX(version), 0) FROM schema_metadata')
    .pluck()
    .get()

  return typeof version === 'number' ? version : 0
}

const verifyWritable = (database: Database): void => {
  const schemaVersion = readSchemaVersion(database)
  const verify = database.transaction(() => {
    database
      .prepare('UPDATE schema_metadata SET applied_at = applied_at WHERE version = ?')
      .run(schemaVersion)
  })
  verify.immediate()
}

class SqliteWorkbenchDatabase implements WorkbenchDatabase {
  readonly path: string

  constructor(path: string, database: Database) {
    this.path = path
    databaseHandles.set(this, database)
  }

  get isOpen(): boolean {
    return getDatabaseHandle(this).open
  }

  status(): DatabaseStatus {
    const database = getDatabaseHandle(this)
    let writable = true

    try {
      verifyWritable(database)
    } catch {
      writable = false
    }

    return {
      foreignKeysEnabled: database.pragma('foreign_keys', { simple: true }) === 1,
      journalMode: String(database.pragma('journal_mode', { simple: true })).toLowerCase(),
      schemaVersion: readSchemaVersion(database),
      writable,
    }
  }

  close(): void {
    const database = getDatabaseHandle(this)
    if (database.open) database.close()
  }
}

export const getDatabaseHandle = (database: WorkbenchDatabase): Database => {
  const handle = databaseHandles.get(database)
  if (handle === undefined) throw new TypeError('Unknown workbench database connection')
  return handle
}

const closeAfterFailure = (database: Database | undefined): void => {
  if (database?.open === true) database.close()
}

export const openDatabase = (options: OpenDatabaseOptions): WorkbenchDatabase => {
  if (options.path.trim() === '' || options.path === ':memory:') {
    throw new DatabaseInitializationError({
      code: 'DATABASE_PATH_INVALID',
      databasePath: options.path,
      message: 'Database path must identify a persistent file',
    })
  }

  const databasePath = resolve(options.path)
  let database: Database | undefined

  try {
    mkdirSync(dirname(databasePath), { recursive: true })
    database = new Database(databasePath)
  } catch (cause) {
    closeAfterFailure(database)
    throw new DatabaseInitializationError({
      code: 'DATABASE_OPEN_FAILED',
      databasePath,
      message: 'Could not open the configured database file',
      cause,
    })
  }

  try {
    initializeCurrentSchema(database)
  } catch (cause) {
    closeAfterFailure(database)
    throw new DatabaseInitializationError({
      code:
        cause instanceof DatabaseSchemaIncompatibleError
          ? 'DATABASE_SCHEMA_INCOMPATIBLE'
          : 'DATABASE_SCHEMA_INITIALIZATION_FAILED',
      databasePath,
      message:
        cause instanceof DatabaseSchemaIncompatibleError
          ? cause.message
          : 'Could not initialize the current SQLite schema',
      cause,
    })
  }

  try {
    const journalMode = database.pragma('journal_mode = WAL', { simple: true })
    database.pragma('foreign_keys = ON')
    if (String(journalMode).toLowerCase() !== 'wal') {
      throw new Error(`Unexpected SQLite journal mode: ${String(journalMode)}`)
    }
    if (database.pragma('foreign_keys', { simple: true }) !== 1) {
      throw new Error('SQLite foreign-key enforcement is disabled')
    }
  } catch (cause) {
    closeAfterFailure(database)
    throw new DatabaseInitializationError({
      code: 'DATABASE_CONFIGURATION_FAILED',
      databasePath,
      message: 'Could not configure the SQLite database',
      cause,
    })
  }

  try {
    verifyWritable(database)
  } catch (cause) {
    closeAfterFailure(database)
    throw new DatabaseInitializationError({
      code: 'DATABASE_NOT_WRITABLE',
      databasePath,
      message: 'Configured database file is not writable',
      cause,
    })
  }

  return new SqliteWorkbenchDatabase(databasePath, database)
}
