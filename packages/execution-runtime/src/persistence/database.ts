import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'

import { applyMigrations } from './migrations.js'

interface BunStatement {
  get(...parameters: unknown[]): Record<string, unknown> | null
  all(...parameters: unknown[]): Record<string, unknown>[]
  run(...parameters: unknown[]): Readonly<{ changes: number; lastInsertRowid: number | bigint }>
}

interface BunTransaction {
  (...parameters: unknown[]): unknown
  deferred(...parameters: unknown[]): unknown
  immediate(...parameters: unknown[]): unknown
  exclusive(...parameters: unknown[]): unknown
}

interface BunDatabase {
  prepare(sql: string): BunStatement
  query(sql: string): BunStatement
  exec(sql: string): unknown
  transaction(action: (...parameters: unknown[]) => unknown): BunTransaction
  close(throwOnError?: boolean): void
}

interface BunSqliteModule {
  readonly Database: new (path: string) => BunDatabase
}

class BunStatementCompatibility {
  readonly #statement: BunStatement
  #pluck = false

  constructor(statement: BunStatement) {
    this.#statement = statement
  }

  pluck(enabled = true): this {
    this.#pluck = enabled
    return this
  }

  get(...parameters: unknown[]): unknown {
    const row = this.#statement.get(...parameters)
    if (!this.#pluck || row === null) return row ?? undefined
    return Object.values(row)[0]
  }

  all(...parameters: unknown[]): unknown[] {
    const rows = this.#statement.all(...parameters)
    return this.#pluck ? rows.map((row) => Object.values(row)[0]) : rows
  }

  run(...parameters: unknown[]): Readonly<{ changes: number; lastInsertRowid: number | bigint }> {
    return this.#statement.run(...parameters)
  }
}

class BunDatabaseCompatibility {
  readonly #database: BunDatabase
  #open = true

  constructor(Database: BunSqliteModule['Database'], path: string) {
    this.#database = new Database(path)
  }

  get open(): boolean {
    return this.#open
  }

  prepare(sql: string): BunStatementCompatibility {
    return new BunStatementCompatibility(this.#database.prepare(sql))
  }

  exec(sql: string): this {
    this.#database.exec(sql)
    return this
  }

  pragma(source: string, options?: Readonly<{ simple?: boolean }>): unknown {
    const rows = this.#database.query(`PRAGMA ${source}`).all()
    if (options?.simple !== true) return rows
    const first = rows[0]
    return first === undefined ? undefined : Object.values(first)[0]
  }

  transaction(action: (...parameters: unknown[]) => unknown): BunTransaction {
    return this.#database.transaction(action)
  }

  close(): void {
    if (!this.#open) return
    this.#database.close()
    this.#open = false
  }
}

type DatabaseFactory = (path: string) => BetterSqlite3.Database

const loadDatabaseFactory = async (): Promise<DatabaseFactory> => {
  if ('Bun' in globalThis) {
    const bunSqliteSpecifier = 'bun:sqlite'
    const sqlite = (await import(bunSqliteSpecifier)) as BunSqliteModule
    return (path) =>
      new BunDatabaseCompatibility(sqlite.Database, path) as unknown as BetterSqlite3.Database
  }
  const sqlite = await import('better-sqlite3')
  return (path) => new sqlite.default(path)
}

const createDatabase = await loadDatabaseFactory()

export type DatabaseInitializationErrorCode =
  | 'DATABASE_PATH_INVALID'
  | 'DATABASE_OPEN_FAILED'
  | 'DATABASE_CONFIGURATION_FAILED'
  | 'DATABASE_MIGRATION_FAILED'
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

const databaseHandles = new WeakMap<WorkbenchDatabase, BetterSqlite3.Database>()

const readSchemaVersion = (database: BetterSqlite3.Database): number => {
  const version = database
    .prepare('SELECT COALESCE(MAX(version), 0) FROM schema_migrations')
    .pluck()
    .get()

  return typeof version === 'number' ? version : 0
}

const verifyWritable = (database: BetterSqlite3.Database): void => {
  const schemaVersion = readSchemaVersion(database)
  const verify = database.transaction(() => {
    database
      .prepare('UPDATE schema_migrations SET applied_at = applied_at WHERE version = ?')
      .run(schemaVersion)
  })
  verify.immediate()
}

class SqliteWorkbenchDatabase implements WorkbenchDatabase {
  readonly path: string

  constructor(path: string, database: BetterSqlite3.Database) {
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

export const getDatabaseHandle = (database: WorkbenchDatabase): BetterSqlite3.Database => {
  const handle = databaseHandles.get(database)
  if (handle === undefined) throw new TypeError('Unknown workbench database connection')
  return handle
}

const closeAfterFailure = (database: BetterSqlite3.Database | undefined): void => {
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
  let database: BetterSqlite3.Database | undefined

  try {
    mkdirSync(dirname(databasePath), { recursive: true })
    database = createDatabase(databasePath)
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
    applyMigrations(database)
  } catch (cause) {
    closeAfterFailure(database)
    throw new DatabaseInitializationError({
      code: 'DATABASE_MIGRATION_FAILED',
      databasePath,
      message: 'Could not migrate the SQLite database',
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
