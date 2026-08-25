import {
  GitShaSchema,
  GitProviderSchema,
  NodeExecutionStatusSchema,
  NodeIdSchema,
  RepositoryIdSchema,
  RunIdSchema,
  RunStatusSchema,
  WorkflowIdSchema,
  type GitSha,
  type GitProvider,
  type NodeExecutionStatus as ContractNodeExecutionStatus,
  type NodeId,
  type RepositoryId,
  type RunId,
  type RunStatus,
  type WorkflowId,
} from '@slopify/contracts'
import { isAbsolute } from 'node:path'
import { WorkflowSchema, type Workflow } from '@slopify/workflow-model'
import { z } from 'zod'

import { appendEvent } from '../events/event-store.js'
import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'
import { mapPersistenceError, PersistenceError } from './errors.js'
import { parseJson, serializeJson, type JsonValue } from './json.js'

export interface RunRecord {
  readonly runId: RunId
  readonly workflowId: WorkflowId
  readonly workflowSnapshot: Workflow
  readonly variables: Readonly<Record<string, JsonValue>>
  readonly status: RunStatus
  readonly transitionCount: number
  readonly createdAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
}

export interface CreateRunInput {
  readonly runId: string
  readonly workflowId: string
  readonly workflowSnapshot: Workflow
  readonly variables: Readonly<Record<string, JsonValue>>
  readonly repositories: readonly CreateRunRepositoryInput[]
  readonly createdAt: string
}

export interface CreateRunRepositoryInput {
  readonly repositoryId: string
  readonly name: string
  readonly provider: GitProvider
  readonly remoteId: string
  readonly fullName: string
  readonly cloneUrl: string
  readonly defaultBranch: string
  readonly baseSha: string
}

export interface ListRunsInput {
  readonly page: number
  readonly pageSize: number
  readonly runId?: string | undefined
  readonly statuses?: readonly RunStatus[] | undefined
  readonly startedFrom?: string | undefined
  readonly startedTo?: string | undefined
  readonly durationMinMs?: number | undefined
  readonly durationMaxMs?: number | undefined
}

export interface RunPage {
  readonly data: readonly RunRecord[]
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly totalItems: number
    readonly totalPages: number
  }
}

export type NodeExecutionStatus = ContractNodeExecutionStatus

export interface NodeExecutionRecord {
  readonly nodeExecutionId: string
  readonly attemptId: string
  readonly nodeId: NodeId
  readonly executionIndex: number
  readonly status: NodeExecutionStatus
  readonly output: JsonValue | null
  readonly outcome: string | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly startedAt: string | null
  readonly completedAt: string | null
  readonly durationMs: number | null
}

export interface RunRepositorySnapshot {
  readonly repositoryId: RepositoryId
  readonly position: number
  readonly name: string
  readonly provider: GitProvider | null
  readonly remoteId: string | null
  readonly fullName: string
  readonly cloneUrl: string
  readonly defaultBranch: string | null
  readonly baseSha: GitSha
  readonly isPrimary: boolean
}

export type RunRepositoryWorkspaceStatus = 'PREPARING' | 'READY' | 'FAILED' | 'CLEANED' | 'LEGACY'

export interface RunRepositoryWorkspace {
  readonly repositoryId: RepositoryId
  readonly position: number
  readonly status: RunRepositoryWorkspaceStatus
  readonly workspacePath: string
  readonly branchName: string | null
  readonly errorMessage: string | null
  readonly preparedAt: string | null
  readonly cleanedAt: string | null
  readonly updatedAt: string
}

export interface MarkRunRepositoryWorkspacePreparingInput {
  readonly runId: RunId
  readonly repositoryId: string
  readonly workspacePath: string
  readonly branchName: string
  readonly timestamp: string
}

export type MarkRunRepositoryWorkspaceReadyInput = MarkRunRepositoryWorkspacePreparingInput

export interface MarkRunRepositoryWorkspaceFailedInput extends MarkRunRepositoryWorkspacePreparingInput {
  readonly errorMessage: string
}

export interface MarkRunRepositoryWorkspaceCleanedInput {
  readonly runId: RunId
  readonly repositoryId: string
  readonly timestamp: string
}

export interface RunRepository {
  create(input: CreateRunInput): RunRecord
  get(runId: RunId): RunRecord | undefined
  list(input: ListRunsInput): RunPage
  listNodeExecutions(runId: RunId): readonly NodeExecutionRecord[]
  listRunRepositories(runId: RunId): readonly RunRepositorySnapshot[]
  listRunRepositoryWorkspaces(runId: RunId): readonly RunRepositoryWorkspace[]
  listTerminalRunIdsNeedingWorkspaceCleanup(): readonly RunId[]
  markRunRepositoryWorkspacePreparing(
    input: MarkRunRepositoryWorkspacePreparingInput,
  ): RunRepositoryWorkspace
  markRunRepositoryWorkspaceReady(
    input: MarkRunRepositoryWorkspaceReadyInput,
  ): RunRepositoryWorkspace
  markRunRepositoryWorkspaceFailed(
    input: MarkRunRepositoryWorkspaceFailedInput,
  ): RunRepositoryWorkspace
  markRunRepositoryWorkspaceCleaned(
    input: MarkRunRepositoryWorkspaceCleanedInput,
  ): RunRepositoryWorkspace
}

interface RunRow {
  readonly run_id: string
  readonly workflow_id: string
  readonly variables_json: string
  readonly workflow_snapshot_json: string
  readonly status: string
  readonly transition_count: number
  readonly created_at: string
  readonly started_at: string | null
  readonly completed_at: string | null
}

interface NodeExecutionRow {
  readonly node_execution_id: string
  readonly attempt_id: string
  readonly node_id: string
  readonly execution_index: number
  readonly status: NodeExecutionStatus
  readonly output_json: string | null
  readonly outcome: string | null
  readonly error_code: string | null
  readonly error_message: string | null
  readonly started_at: string | null
  readonly completed_at: string | null
  readonly duration_ms: number | null
}

interface RunRepositoryRow {
  readonly repository_id: string
  readonly repository_position: number
  readonly name: string
  readonly provider: string | null
  readonly remote_id: string | null
  readonly repository_full_name: string
  readonly clone_url: string
  readonly default_branch: string | null
  readonly base_sha: string
  readonly is_primary: number
}

interface RunRepositoryWorkspaceRow {
  readonly repository_id: string
  readonly repository_position: number
  readonly status: RunRepositoryWorkspaceStatus
  readonly workspace_path: string
  readonly branch_name: string | null
  readonly error_message: string | null
  readonly prepared_at: string | null
  readonly cleaned_at: string | null
  readonly updated_at: string
}

const CreateRunRepositoryInputSchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  name: z.string().trim().min(1).max(256),
  provider: GitProviderSchema,
  remoteId: z.string().regex(/^\d+$/u).max(128),
  fullName: z.string().trim().min(1).max(512),
  cloneUrl: z.url({ protocol: /^https$/u }).max(4_096),
  defaultBranch: z.string().trim().min(1).max(512),
  baseSha: GitShaSchema,
})

const timestamp = z.iso.datetime({ offset: true })
const variablesSchema = z.record(z.string().trim().min(1).max(128), z.json())

const validationFailure = (message: string, cause?: unknown): PersistenceError =>
  new PersistenceError({ code: 'PERSISTENCE_VALIDATION_FAILED', message, cause })

const parseInput = <Output>(schema: z.ZodType<Output>, value: unknown, message: string): Output => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw validationFailure(message, parsed.error)
  return parsed.data
}

const requireNonBlank = (value: string, field: string): string => {
  if (value.trim() === '') throw validationFailure(`${field} must not be blank`)
  return value
}

const mapRun = (row: RunRow): RunRecord => ({
  runId: RunIdSchema.parse(row.run_id),
  workflowId: WorkflowIdSchema.parse(row.workflow_id),
  workflowSnapshot: WorkflowSchema.parse(parseJson(row.workflow_snapshot_json)),
  variables: variablesSchema.parse(parseJson(row.variables_json)),
  status: RunStatusSchema.parse(row.status),
  transitionCount: row.transition_count,
  createdAt: row.created_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
})

const mapRunRepository = (row: RunRepositoryRow): RunRepositorySnapshot => ({
  repositoryId: RepositoryIdSchema.parse(row.repository_id),
  position: row.repository_position,
  name: row.name,
  provider: row.provider === null ? null : GitProviderSchema.parse(row.provider),
  remoteId: row.remote_id,
  fullName: row.repository_full_name,
  cloneUrl: row.clone_url,
  defaultBranch: row.default_branch,
  baseSha: GitShaSchema.parse(row.base_sha),
  isPrimary: row.is_primary === 1,
})

const mapRunRepositoryWorkspace = (row: RunRepositoryWorkspaceRow): RunRepositoryWorkspace => ({
  repositoryId: RepositoryIdSchema.parse(row.repository_id),
  position: row.repository_position,
  status: row.status,
  workspacePath: row.workspace_path,
  branchName: row.branch_name,
  errorMessage: row.error_message,
  preparedAt: row.prepared_at,
  cleanedAt: row.cleaned_at,
  updatedAt: row.updated_at,
})

const runSelection = `
  SELECT run_id, workflow_id, variables_json, workflow_snapshot_json,
         status, transition_count, created_at,
         started_at, completed_at
  FROM runs`

export const createRunRepository = (database: WorkbenchDatabase): RunRepository => {
  const connection = getDatabaseHandle(database)

  const get = (runIdInput: RunId): RunRecord | undefined => {
    const runId = RunIdSchema.parse(runIdInput)
    const row = connection.prepare(`${runSelection} WHERE run_id = ?`).get(runId) as
      RunRow | undefined
    return row === undefined ? undefined : mapRun(row)
  }

  const listRunRepositories = (runIdInput: RunId): readonly RunRepositorySnapshot[] => {
    const runId = RunIdSchema.parse(runIdInput)
    const rows = connection
      .prepare(
        `SELECT repository_id, repository_position, name, provider, remote_id,
                repository_full_name, clone_url, default_branch, base_sha, is_primary
         FROM run_repositories
         WHERE run_id = ?
         ORDER BY repository_position`,
      )
      .all(runId) as RunRepositoryRow[]
    return rows.map(mapRunRepository)
  }

  const listRunRepositoryWorkspaces = (runIdInput: RunId): readonly RunRepositoryWorkspace[] => {
    const runId = RunIdSchema.parse(runIdInput)
    const rows = connection
      .prepare(
        `SELECT workspace.repository_id, repository.repository_position,
                workspace.status, workspace.workspace_path, workspace.branch_name,
                workspace.error_message, workspace.prepared_at,
                workspace.cleaned_at, workspace.updated_at
         FROM run_repository_workspaces AS workspace
         JOIN run_repositories AS repository
           ON repository.run_id = workspace.run_id
          AND repository.repository_id = workspace.repository_id
         WHERE workspace.run_id = ?
         ORDER BY repository.repository_position`,
      )
      .all(runId) as RunRepositoryWorkspaceRow[]
    return rows.map(mapRunRepositoryWorkspace)
  }

  const getRunRepositoryWorkspace = (
    runId: RunId,
    repositoryId: RepositoryId,
  ): RunRepositoryWorkspace | undefined =>
    listRunRepositoryWorkspaces(runId).find((workspace) => workspace.repositoryId === repositoryId)

  const requireRunRepositoryWorkspace = (
    runId: RunId,
    repositoryId: RepositoryId,
  ): RunRepositoryWorkspace => {
    const workspace = getRunRepositoryWorkspace(runId, repositoryId)
    if (workspace === undefined) {
      throw new PersistenceError({
        code: 'PERSISTENCE_NOT_FOUND',
        message: 'Run repository workspace was not found',
        details: { runId, repositoryId },
      })
    }
    return workspace
  }

  return {
    create(input) {
      const runId = parseInput(RunIdSchema, input.runId, 'Run id is invalid') as RunId
      const workflowId = parseInput(
        WorkflowIdSchema,
        input.workflowId,
        'Workflow id is invalid',
      ) as WorkflowId
      const workflowSnapshot = parseInput(
        WorkflowSchema,
        input.workflowSnapshot,
        'Workflow snapshot is invalid',
      )
      if (workflowSnapshot.workflowId !== workflowId) {
        throw validationFailure('Workflow snapshot does not match the run workflow')
      }
      const variables = parseInput(variablesSchema, input.variables, 'Run variables are invalid')
      const declaredVariables = new Set(workflowSnapshot.configuration.variables)
      const suppliedVariables = Object.keys(variables)
      if (
        suppliedVariables.length !== declaredVariables.size ||
        suppliedVariables.some((name) => !declaredVariables.has(name))
      ) {
        throw validationFailure('Run variables do not match the workflow variables')
      }
      if (!Array.isArray(input.repositories)) {
        throw validationFailure('Run repository snapshot is required')
      }
      const repositories = input.repositories.map((repository) =>
        parseInput(
          CreateRunRepositoryInputSchema,
          repository,
          'Run repository snapshot is invalid',
        ),
      )
      const configuredRepositoryIds = workflowSnapshot.configuration.repositoryIds
      if (
        repositories.length !== configuredRepositoryIds.length ||
        repositories.some(
          (repository, position) => repository.repositoryId !== configuredRepositoryIds[position],
        )
      ) {
        throw validationFailure(
          'Run repository snapshot does not match the workflow repository order',
        )
      }
      const createdAt = parseInput(timestamp, input.createdAt, 'Run creation timestamp is invalid')
      const variablesJson = serializeJson(variables, 'variables')
      const workflowSnapshotJson = serializeJson(
        workflowSnapshot as unknown as JsonValue,
        'workflowSnapshot',
      )

      try {
        connection
          .transaction(() => {
            connection
              .prepare(
                `INSERT INTO runs (
                   run_id, workflow_id, variables_json, workflow_snapshot_json,
                   status, created_at
                 ) VALUES (?, ?, ?, ?, 'PENDING', ?)`,
              )
              .run(runId, workflowId, variablesJson, workflowSnapshotJson, createdAt)
            const insertRepository = connection.prepare(
              `INSERT INTO run_repositories (
                 run_id, repository_id, repository_position, name, provider, remote_id,
                 repository_full_name, clone_url, default_branch, base_sha, is_primary
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            for (const [position, repository] of repositories.entries()) {
              insertRepository.run(
                runId,
                repository.repositoryId,
                position,
                repository.name,
                repository.provider,
                repository.remoteId,
                repository.fullName,
                repository.cloneUrl,
                repository.defaultBranch,
                repository.baseSha,
                repository.repositoryId === workflowSnapshot.configuration.primaryRepositoryId
                  ? 1
                  : 0,
              )
            }
            appendEvent(connection, runId, {
              type: 'RUN_STARTED',
              timestamp: createdAt,
              data: { workflowId },
            })
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not create run')
      }

      const created = get(runId)
      if (created === undefined) {
        throw new PersistenceError({
          code: 'PERSISTENCE_READ_FAILED',
          message: 'Persisted run could not be read',
        })
      }
      return created
    },

    get,

    list(input) {
      if (
        !Number.isSafeInteger(input.page) ||
        input.page < 1 ||
        !Number.isSafeInteger(input.pageSize) ||
        input.pageSize < 1 ||
        input.pageSize > 100
      ) {
        throw validationFailure('Run pagination is outside the supported range')
      }
      const clauses: string[] = []
      const parameters: (string | number)[] = []
      if (input.runId !== undefined) {
        clauses.push(`run_id LIKE ? ESCAPE '\\'`)
        parameters.push(
          `%${input.runId.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`,
        )
      }
      if (input.statuses !== undefined && input.statuses.length > 0) {
        const statuses = input.statuses.map((status) => RunStatusSchema.parse(status))
        clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`)
        parameters.push(...statuses)
      }
      if (input.startedFrom !== undefined) {
        clauses.push('unixepoch(started_at) >= unixepoch(?)')
        parameters.push(input.startedFrom)
      }
      if (input.startedTo !== undefined) {
        clauses.push('unixepoch(started_at) <= unixepoch(?)')
        parameters.push(input.startedTo)
      }
      const durationExpression =
        'CAST(ROUND((julianday(completed_at) - julianday(started_at)) * 86400000) AS INTEGER)'
      if (input.durationMinMs !== undefined) {
        clauses.push(`${durationExpression} >= ?`)
        parameters.push(input.durationMinMs)
      }
      if (input.durationMaxMs !== undefined) {
        clauses.push(`${durationExpression} <= ?`)
        parameters.push(input.durationMaxMs)
      }
      const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
      const totalItems = connection
        .prepare(`SELECT COUNT(*) FROM runs ${where}`)
        .pluck()
        .get(...parameters)
      if (typeof totalItems !== 'number') {
        throw new PersistenceError({
          code: 'PERSISTENCE_READ_FAILED',
          message: 'Run count could not be read',
        })
      }
      const rows = connection
        .prepare(
          `${runSelection}
           ${where}
           ORDER BY created_at DESC, run_id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...parameters, input.pageSize, (input.page - 1) * input.pageSize) as RunRow[]
      return {
        data: rows.map(mapRun),
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / input.pageSize),
        },
      }
    },

    listNodeExecutions(runIdInput) {
      const runId = RunIdSchema.parse(runIdInput)
      const rows = connection
        .prepare(
          `SELECT node_execution_id, attempt_id, node_id, execution_index, status,
                  output_json, outcome, error_code, error_message,
                  started_at, completed_at, duration_ms
           FROM node_executions
           WHERE run_id = ?
           ORDER BY execution_index`,
        )
        .all(runId) as NodeExecutionRow[]
      return rows.map((row) => ({
        nodeExecutionId: row.node_execution_id,
        attemptId: row.attempt_id,
        nodeId: NodeIdSchema.parse(row.node_id),
        executionIndex: row.execution_index,
        status: NodeExecutionStatusSchema.parse(row.status),
        output: row.output_json === null ? null : parseJson(row.output_json),
        outcome: row.outcome,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        durationMs: row.duration_ms,
      }))
    },

    listRunRepositories,

    listRunRepositoryWorkspaces,

    listTerminalRunIdsNeedingWorkspaceCleanup() {
      const rows = connection
        .prepare(
          `SELECT DISTINCT workspace.run_id
           FROM run_repository_workspaces AS workspace
           JOIN runs AS run ON run.run_id = workspace.run_id
           WHERE run.status IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
             AND workspace.status NOT IN ('CLEANED', 'LEGACY')
           ORDER BY workspace.run_id`,
        )
        .all() as { run_id: string }[]
      return rows.map(({ run_id: runId }) => RunIdSchema.parse(runId))
    },

    markRunRepositoryWorkspacePreparing(input) {
      const runId = RunIdSchema.parse(input.runId)
      const repositoryId = RepositoryIdSchema.parse(input.repositoryId)
      const workspacePath = requireNonBlank(input.workspacePath, 'workspacePath')
      const branchName = requireNonBlank(input.branchName, 'branchName')
      const updatedAt = parseInput(timestamp, input.timestamp, 'Workspace timestamp is invalid')
      if (!isAbsolute(workspacePath)) {
        throw validationFailure('Run repository workspace path must be absolute')
      }
      if (
        !listRunRepositories(runId).some((repository) => repository.repositoryId === repositoryId)
      ) {
        throw new PersistenceError({
          code: 'PERSISTENCE_NOT_FOUND',
          message: 'Run repository was not found',
          details: { runId, repositoryId },
        })
      }
      const existing = getRunRepositoryWorkspace(runId, repositoryId)
      if (
        existing !== undefined &&
        (existing.workspacePath !== workspacePath || existing.branchName !== branchName)
      ) {
        throw new PersistenceError({
          code: 'PERSISTENCE_CONFLICT',
          message: 'Run repository workspace identity cannot be changed',
          details: { runId, repositoryId, workspacePath, branchName },
        })
      }
      if (existing?.status === 'READY') return existing

      try {
        connection
          .prepare(
            `INSERT INTO run_repository_workspaces (
               run_id, repository_id, status, workspace_path, branch_name,
               error_message, prepared_at, cleaned_at, updated_at
             ) VALUES (?, ?, 'PREPARING', ?, ?, NULL, NULL, NULL, ?)
             ON CONFLICT (run_id, repository_id) DO UPDATE SET
               status = 'PREPARING', error_message = NULL,
               prepared_at = NULL, cleaned_at = NULL, updated_at = excluded.updated_at`,
          )
          .run(runId, repositoryId, workspacePath, branchName, updatedAt)
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not mark run repository workspace as preparing')
      }
      return requireRunRepositoryWorkspace(runId, repositoryId)
    },

    markRunRepositoryWorkspaceReady(input) {
      const runId = RunIdSchema.parse(input.runId)
      const repositoryId = RepositoryIdSchema.parse(input.repositoryId)
      const workspacePath = requireNonBlank(input.workspacePath, 'workspacePath')
      const branchName = requireNonBlank(input.branchName, 'branchName')
      const updatedAt = parseInput(timestamp, input.timestamp, 'Workspace timestamp is invalid')
      const existing = requireRunRepositoryWorkspace(runId, repositoryId)
      if (existing.workspacePath !== workspacePath || existing.branchName !== branchName) {
        throw new PersistenceError({
          code: 'PERSISTENCE_CONFLICT',
          message: 'Run repository workspace does not match its preparation',
          details: { runId, repositoryId, workspacePath, branchName },
        })
      }
      if (existing.status === 'READY') return existing
      if (existing.status !== 'PREPARING') {
        throw new PersistenceError({
          code: 'PERSISTENCE_CONFLICT',
          message: 'Only a preparing run repository workspace can become ready',
          details: { runId, repositoryId, status: existing.status },
        })
      }
      try {
        connection
          .prepare(
            `UPDATE run_repository_workspaces
             SET status = 'READY', error_message = NULL,
                 prepared_at = ?, updated_at = ?
             WHERE run_id = ? AND repository_id = ? AND status = 'PREPARING'`,
          )
          .run(updatedAt, updatedAt, runId, repositoryId)
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not mark run repository workspace as ready')
      }
      return requireRunRepositoryWorkspace(runId, repositoryId)
    },

    markRunRepositoryWorkspaceFailed(input) {
      const runId = RunIdSchema.parse(input.runId)
      const repositoryId = RepositoryIdSchema.parse(input.repositoryId)
      const workspacePath = requireNonBlank(input.workspacePath, 'workspacePath')
      const branchName = requireNonBlank(input.branchName, 'branchName')
      const errorMessage = parseInput(
        z.string().trim().min(1).max(4_096),
        input.errorMessage,
        'Workspace failure message is invalid',
      )
      const updatedAt = parseInput(timestamp, input.timestamp, 'Workspace timestamp is invalid')
      const existing = requireRunRepositoryWorkspace(runId, repositoryId)
      if (existing.workspacePath !== workspacePath || existing.branchName !== branchName) {
        throw new PersistenceError({
          code: 'PERSISTENCE_CONFLICT',
          message: 'Run repository workspace does not match its preparation',
          details: { runId, repositoryId, workspacePath, branchName },
        })
      }
      try {
        connection
          .prepare(
            `UPDATE run_repository_workspaces
             SET status = 'FAILED', error_message = ?,
                 prepared_at = NULL, updated_at = ?
             WHERE run_id = ? AND repository_id = ?`,
          )
          .run(errorMessage, updatedAt, runId, repositoryId)
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not mark run repository workspace as failed')
      }
      return requireRunRepositoryWorkspace(runId, repositoryId)
    },

    markRunRepositoryWorkspaceCleaned(input) {
      const runId = RunIdSchema.parse(input.runId)
      const repositoryId = RepositoryIdSchema.parse(input.repositoryId)
      const cleanedAt = parseInput(timestamp, input.timestamp, 'Workspace timestamp is invalid')
      const existing = requireRunRepositoryWorkspace(runId, repositoryId)
      if (existing.status === 'CLEANED' || existing.status === 'LEGACY') return existing
      try {
        connection
          .prepare(
            `UPDATE run_repository_workspaces
             SET status = 'CLEANED', error_message = NULL,
                 cleaned_at = ?, updated_at = ?
             WHERE run_id = ? AND repository_id = ?`,
          )
          .run(cleanedAt, cleanedAt, runId, repositoryId)
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not mark run repository workspace as cleaned')
      }
      return requireRunRepositoryWorkspace(runId, repositoryId)
    },
  }
}
