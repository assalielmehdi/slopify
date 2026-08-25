import { z } from 'zod'

import { SLOPIFY_DATABASE_APPLICATION_ID } from '../persistence/schema.js'
import { Database } from '../persistence/sqlite.js'

const SchemaMarkerSchema = z.object({
  version: z.number().int().min(1).max(4),
  name: z.literal('current_schema'),
})

const IntegrityRowSchema = z.object({ integrity_check: z.string() })
const ActiveRunSchema = z.object({ run_id: z.string(), status: z.enum(['PENDING', 'RUNNING']) })

export interface LegacyDatabaseInspection {
  readonly schemaVersion: number
  readonly activeRuns: readonly Readonly<{ runId: string; status: 'PENDING' | 'RUNNING' }>[]
}

export interface LegacySqliteReader {
  inspect(): LegacyDatabaseInspection
  close(): void
}

export class LegacySqliteReaderError extends Error {
  constructor(
    readonly code: 'INVALID_DATABASE',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'LegacySqliteReaderError'
  }
}

const invalidDatabase = (message: string, cause?: unknown): LegacySqliteReaderError =>
  new LegacySqliteReaderError(
    'INVALID_DATABASE',
    message,
    cause === undefined ? undefined : { cause },
  )

export const openLegacySqliteReader = (path: string): LegacySqliteReader => {
  let database: Database
  try {
    database = new Database(path, { readonly: true, create: false })
  } catch (error) {
    throw invalidDatabase('The legacy database could not be opened read-only.', error)
  }

  return {
    inspect() {
      try {
        const integrity = z.array(IntegrityRowSchema).parse(database.pragma('integrity_check'))
        if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok')
          throw invalidDatabase('The legacy database failed its integrity check.')

        const applicationId = z
          .number()
          .int()
          .parse(database.pragma('application_id', { simple: true }))
        if (applicationId !== SLOPIFY_DATABASE_APPLICATION_ID)
          throw invalidDatabase('The database is not owned by Slopify.')

        const marker = SchemaMarkerSchema.parse(
          database.prepare('SELECT version, name FROM schema_metadata').get(),
        )
        const tables = new Set(
          z.array(z.string()).parse(
            database
              .prepare(
                `SELECT name FROM sqlite_schema
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
              )
              .pluck()
              .all(),
          ),
        )
        const repositoryTable = marker.version >= 3 ? 'repositories' : 'projects'
        if (
          ![repositoryTable, 'runs', 'schema_metadata', 'workflows'].every((table) =>
            tables.has(table),
          )
        )
          throw invalidDatabase('The legacy database schema is incomplete.')

        const activeRuns = z
          .array(ActiveRunSchema)
          .parse(
            database
              .prepare(
                `SELECT run_id, status FROM runs
                 WHERE status IN ('PENDING', 'RUNNING')
                 ORDER BY run_id`,
              )
              .all(),
          )
          .map((run) => ({ runId: run.run_id, status: run.status }))

        return { schemaVersion: marker.version, activeRuns }
      } catch (error) {
        if (error instanceof LegacySqliteReaderError) throw error
        throw invalidDatabase('The legacy database is not a supported Slopify database.', error)
      }
    },
    close() {
      database.close()
    },
  }
}
