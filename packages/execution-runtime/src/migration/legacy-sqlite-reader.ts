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
const TerminalRunRowSchema = z.object({
  run_id: z.string(),
  workflow_id: z.string(),
  variables_json: z.string(),
  workflow_snapshot_json: z.string(),
  status: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED']),
  transition_count: z.number().int().nonnegative(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
})
const RunRepositoryRowSchema = z.object({
  repository_id: z.string(),
  repository_position: z.number().int().nonnegative(),
  name: z.string(),
  provider: z.string().nullable(),
  remote_id: z.string().nullable(),
  repository_full_name: z.string(),
  clone_url: z.string(),
  default_branch: z.string().nullable(),
  base_sha: z.string(),
  is_primary: z.number().int(),
})
const RunWorkspaceRowSchema = z.object({
  repository_id: z.string(),
  repository_position: z.number().int().nonnegative(),
  status: z.enum(['PREPARING', 'READY', 'FAILED', 'CLEANED', 'LEGACY']),
  workspace_path: z.string(),
  branch_name: z.string().nullable(),
  error_message: z.string().nullable(),
  prepared_at: z.string().nullable(),
  cleaned_at: z.string().nullable(),
  updated_at: z.string(),
})
const NodeExecutionRowSchema = z.object({
  node_execution_id: z.string(),
  attempt_id: z.string(),
  node_id: z.string(),
  execution_index: z.number().int().nonnegative(),
  status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  output_json: z.string().nullable(),
  outcome: z.string().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
})

export interface LegacyDatabaseInspection {
  readonly schemaVersion: number
  readonly activeRuns: readonly Readonly<{ runId: string; status: 'PENDING' | 'RUNNING' }>[]
}

export interface LegacyCatalogSnapshot {
  readonly connections: readonly ReturnType<typeof GitConnectionSchema.parse>[]
  readonly repositories: readonly RepositoryRecord[]
  readonly workflows: readonly Readonly<{ workflowId: string; definition: unknown }>[]
}

export interface LegacyTerminalRun {
  readonly runId: string
  readonly workflowId: string
  readonly variables: unknown
  readonly workflowSnapshot: unknown
  readonly status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  readonly transitionCount: number
  readonly createdAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
  readonly cancelReason: string | null
  readonly repositories: readonly Readonly<{
    repositoryId: string
    position: number
    name: string
    provider: string | null
    remoteId: string | null
    fullName: string
    cloneUrl: string
    defaultBranch: string | null
    baseSha: string
    isPrimary: boolean
  }>[]
  readonly workspaces: readonly Readonly<{
    repositoryId: string
    position: number
    status: 'PREPARING' | 'READY' | 'FAILED' | 'CLEANED' | 'LEGACY'
    workspacePath: string
    branchName: string | null
    errorMessage: string | null
    preparedAt: string | null
    cleanedAt: string | null
    updatedAt: string
  }>[]
  readonly nodes: readonly Readonly<{
    nodeExecutionId: string
    attemptId: string
    nodeId: string
    executionIndex: number
    status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
    output: unknown | null
    outcome: string | null
    errorCode: string | null
    errorMessage: string | null
    startedAt: string | null
    completedAt: string | null
    durationMs: number | null
  }>[]
}

export interface LegacySqliteReader {
  inspect(): LegacyDatabaseInspection
  readCatalog(): LegacyCatalogSnapshot
  readTerminalRuns(): readonly LegacyTerminalRun[]
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
    readTerminalRuns: () =>
      read(() => {
        const schemaVersion = readSchemaMarker().version
        const repositoryTable = schemaVersion >= 3 ? 'run_repositories' : 'run_projects'
        const repositoryIdColumn = schemaVersion >= 3 ? 'repository_id' : 'project_id'
        const workspaceTable =
          schemaVersion >= 3 ? 'run_repository_workspaces' : 'run_project_workspaces'
        const runs = z.array(TerminalRunRowSchema).parse(
          database
            .prepare(
              `SELECT run_id, workflow_id, variables_json, workflow_snapshot_json,
                        status, transition_count, created_at, started_at, completed_at
                 FROM runs
                 WHERE status IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
                 ORDER BY created_at, run_id`,
            )
            .all(),
        )

        return runs.map((run) => {
          const repositories = z
            .array(RunRepositoryRowSchema)
            .parse(
              database
                .prepare(
                  `SELECT ${repositoryIdColumn} AS repository_id,
                          repository_position, name, provider, remote_id,
                          repository_full_name, clone_url, default_branch,
                          base_sha, is_primary
                   FROM ${repositoryTable}
                   WHERE run_id = ? ORDER BY repository_position`,
                )
                .all(run.run_id),
            )
            .map((repository) => ({
              repositoryId: repository.repository_id,
              position: repository.repository_position,
              name: repository.name,
              provider: repository.provider,
              remoteId: repository.remote_id,
              fullName: repository.repository_full_name,
              cloneUrl: repository.clone_url,
              defaultBranch: repository.default_branch,
              baseSha: repository.base_sha,
              isPrimary: repository.is_primary === 1,
            }))
          const workspaces = z
            .array(RunWorkspaceRowSchema)
            .parse(
              database
                .prepare(
                  `SELECT workspace.${repositoryIdColumn} AS repository_id,
                          repository.repository_position,
                          workspace.status, workspace.workspace_path,
                          workspace.branch_name, workspace.error_message,
                          workspace.prepared_at, workspace.cleaned_at, workspace.updated_at
                   FROM ${workspaceTable} AS workspace
                   JOIN ${repositoryTable} AS repository
                     ON repository.run_id = workspace.run_id
                    AND repository.${repositoryIdColumn} = workspace.${repositoryIdColumn}
                   WHERE workspace.run_id = ? ORDER BY repository.repository_position`,
                )
                .all(run.run_id),
            )
            .map((workspace) => ({
              repositoryId: workspace.repository_id,
              position: workspace.repository_position,
              status: workspace.status,
              workspacePath: workspace.workspace_path,
              branchName: workspace.branch_name,
              errorMessage: workspace.error_message,
              preparedAt: workspace.prepared_at,
              cleanedAt: workspace.cleaned_at,
              updatedAt: workspace.updated_at,
            }))
          const nodes = z
            .array(NodeExecutionRowSchema)
            .parse(
              database
                .prepare(
                  `SELECT node_execution_id, attempt_id, node_id, execution_index, status,
                          output_json, outcome, error_code, error_message,
                          started_at, completed_at, duration_ms
                   FROM node_executions WHERE run_id = ? ORDER BY execution_index`,
                )
                .all(run.run_id),
            )
            .map((node) => ({
              nodeExecutionId: node.node_execution_id,
              attemptId: node.attempt_id,
              nodeId: node.node_id,
              executionIndex: node.execution_index,
              status: node.status,
              output: node.output_json === null ? null : (JSON.parse(node.output_json) as unknown),
              outcome: node.outcome,
              errorCode: node.error_code,
              errorMessage: node.error_message,
              startedAt: node.started_at,
              completedAt: node.completed_at,
              durationMs: node.duration_ms,
            }))
          const cancelData = database
            .prepare(
              `SELECT data_json FROM run_events
               WHERE run_id = ? AND event_type = 'RUN_CANCEL_REQUESTED'
               ORDER BY sequence DESC LIMIT 1`,
            )
            .pluck()
            .get(run.run_id)
          const cancelReason =
            typeof cancelData === 'string'
              ? z.object({ reason: z.string() }).parse(JSON.parse(cancelData)).reason
              : null
          return {
            runId: run.run_id,
            workflowId: run.workflow_id,
            variables: JSON.parse(run.variables_json) as unknown,
            workflowSnapshot: JSON.parse(run.workflow_snapshot_json) as unknown,
            status: run.status,
            transitionCount: run.transition_count,
            createdAt: run.created_at,
            startedAt: run.started_at,
            completedAt: run.completed_at,
            cancelReason,
            repositories,
            workspaces,
            nodes,
          }
        })
      }),
    close() {
      database.close()
    },
  }
}
