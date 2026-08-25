import { GitConnectionSchema } from '@slopify/contracts'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

import { SLOPIFY_DATABASE_APPLICATION_ID } from '../persistence/schema.js'
import { Database } from '../persistence/sqlite.js'
import { RepositoryRecordSchema, type RepositoryRecord } from '../repositories/repository-store.js'

const SchemaMarkerSchema = z.object({
  version: z.number().int().min(1).max(4),
  name: z.literal('current_schema'),
})

const IntegrityRowSchema = z.object({ integrity_check: z.string() })
const ActiveRunSchema = z.object({ run_id: z.string(), status: z.enum(['PENDING', 'RUNNING']) })
const GitConnectionRowSchema = z.object({
  provider: z.string(),
  account_username: z.string(),
  connected_at: z.string(),
  updated_at: z.string(),
})
const RepositoryRowSchema = z.object({
  repository_id: z.string(),
  name: z.string(),
  provider: z.string(),
  remote_id: z.string(),
  repository_full_name: z.string(),
  clone_url: z.string(),
  web_url: z.string(),
  default_branch: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})
const WorkflowRowSchema = z.object({ workflow_id: z.string(), definition_json: z.string() })

export interface LegacyDatabaseInspection {
  readonly schemaVersion: number
  readonly activeRuns: readonly Readonly<{ runId: string; status: 'PENDING' | 'RUNNING' }>[]
}

export interface LegacyCatalogSnapshot {
  readonly connections: readonly ReturnType<typeof GitConnectionSchema.parse>[]
  readonly repositories: readonly RepositoryRecord[]
  readonly workflows: readonly Readonly<{ workflowId: string; definition: unknown }>[]
}

export interface LegacySqliteReader {
  inspect(): LegacyDatabaseInspection
  readCatalog(): LegacyCatalogSnapshot
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

export const openLegacySqliteReader = (
  path: string,
  options: Readonly<{ immutable?: boolean }> = {},
): LegacySqliteReader => {
  let database: Database
  try {
    const filename = options.immutable
      ? (() => {
          const url = pathToFileURL(path)
          url.searchParams.set('immutable', '1')
          return url.href
        })()
      : path
    database = new Database(filename, { readonly: true, create: false })
  } catch (error) {
    throw invalidDatabase('The legacy database could not be opened read-only.', error)
  }

  const readSchemaMarker = () =>
    SchemaMarkerSchema.parse(database.prepare('SELECT version, name FROM schema_metadata').get())

  const read = <Value>(operation: () => Value): Value => {
    try {
      return operation()
    } catch (error) {
      if (error instanceof LegacySqliteReaderError) throw error
      throw invalidDatabase('The legacy database is not a supported Slopify database.', error)
    }
  }

  return {
    inspect: () =>
      read(() => {
        const integrity = z.array(IntegrityRowSchema).parse(database.pragma('integrity_check'))
        if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok')
          throw invalidDatabase('The legacy database failed its integrity check.')

        const applicationId = z
          .number()
          .int()
          .parse(database.pragma('application_id', { simple: true }))
        if (applicationId !== SLOPIFY_DATABASE_APPLICATION_ID)
          throw invalidDatabase('The database is not owned by Slopify.')

        const marker = readSchemaMarker()
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
      }),
    readCatalog: () =>
      read(() => {
        const schemaVersion = readSchemaMarker().version
        const connections =
          schemaVersion === 1
            ? []
            : z
                .array(GitConnectionRowSchema)
                .parse(
                  database
                    .prepare(
                      `SELECT provider, account_username, connected_at, updated_at
                       FROM git_connections ORDER BY provider`,
                    )
                    .all(),
                )
                .map((row) =>
                  GitConnectionSchema.parse({
                    provider: row.provider,
                    accountUsername: row.account_username,
                    connectedAt: row.connected_at,
                    updatedAt: row.updated_at,
                  }),
                )
        const repositoryTable = schemaVersion >= 3 ? 'repositories' : 'projects'
        const repositoryIdColumn = schemaVersion >= 3 ? 'repository_id' : 'project_id'
        const repositories = z
          .array(RepositoryRowSchema)
          .parse(
            database
              .prepare(
                `SELECT ${repositoryIdColumn} AS repository_id, name, provider, remote_id,
                        repository_full_name, clone_url, web_url, default_branch,
                        created_at, updated_at
                 FROM ${repositoryTable}
                 WHERE deleted_at IS NULL
                 ORDER BY ${repositoryIdColumn}`,
              )
              .all(),
          )
          .map((row) =>
            RepositoryRecordSchema.parse({
              repositoryId: row.repository_id,
              name: row.name,
              provider: row.provider,
              remoteId: row.remote_id,
              fullName: row.repository_full_name,
              cloneUrl: row.clone_url,
              webUrl: row.web_url,
              defaultBranch: row.default_branch,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            }),
          )
        const workflowFilter = schemaVersion >= 4 ? 'WHERE deleted_at IS NULL' : ''
        const workflows = z
          .array(WorkflowRowSchema)
          .parse(
            database
              .prepare(
                `SELECT workflow_id, definition_json FROM workflows
                 ${workflowFilter} ORDER BY workflow_id`,
              )
              .all(),
          )
          .map((row) => ({
            workflowId: row.workflow_id,
            definition: JSON.parse(row.definition_json) as unknown,
          }))

        return { connections, repositories, workflows }
      }),
    close() {
      database.close()
    },
  }
}
