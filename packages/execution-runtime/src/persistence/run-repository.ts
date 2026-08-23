import {
  GitShaSchema,
  NodeExecutionStatusSchema,
  NodeIdSchema,
  ProjectIdSchema,
  RunIdSchema,
  RunStatusSchema,
  WorkflowIdSchema,
  type GitSha,
  type NodeExecutionStatus as ContractNodeExecutionStatus,
  type NodeId,
  type ProjectId,
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
  readonly projects: readonly CreateRunProjectInput[]
  readonly createdAt: string
}

export interface CreateRunProjectInput {
  readonly projectId: string
  readonly name: string
  readonly repositoryPath: string
  readonly baseSha: string
  readonly sourceBranch: string | null
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

export interface RunProjectSnapshot {
  readonly projectId: ProjectId
  readonly position: number
  readonly name: string
  readonly repositoryPath: string
  readonly baseSha: GitSha
  readonly sourceBranch: string | null
  readonly isPrimary: boolean
}

export type RunProjectWorktreeStatus = 'PREPARING' | 'READY' | 'FAILED'

export interface RunProjectWorktree {
  readonly projectId: ProjectId
  readonly position: number
  readonly status: RunProjectWorktreeStatus
  readonly worktreePath: string
  readonly errorMessage: string | null
  readonly preparedAt: string | null
  readonly updatedAt: string
}

export interface MarkRunProjectWorktreePreparingInput {
  readonly runId: RunId
  readonly projectId: string
  readonly worktreePath: string
  readonly timestamp: string
}

export type MarkRunProjectWorktreeReadyInput = MarkRunProjectWorktreePreparingInput

export interface MarkRunProjectWorktreeFailedInput extends MarkRunProjectWorktreePreparingInput {
  readonly errorMessage: string
}

export interface RunRepository {
  create(input: CreateRunInput): RunRecord
  get(runId: RunId): RunRecord | undefined
  list(input: ListRunsInput): RunPage
  listNodeExecutions(runId: RunId): readonly NodeExecutionRecord[]
  listRunProjects(runId: RunId): readonly RunProjectSnapshot[]
  listRunProjectWorktrees(runId: RunId): readonly RunProjectWorktree[]
  markRunProjectWorktreePreparing(input: MarkRunProjectWorktreePreparingInput): RunProjectWorktree
  markRunProjectWorktreeReady(input: MarkRunProjectWorktreeReadyInput): RunProjectWorktree
  markRunProjectWorktreeFailed(input: MarkRunProjectWorktreeFailedInput): RunProjectWorktree
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

interface RunProjectRow {
  readonly project_id: string
  readonly project_position: number
  readonly name: string
  readonly repository_path: string
  readonly base_sha: string
  readonly source_branch: string | null
  readonly is_primary: number
}

interface RunProjectWorktreeRow {
  readonly project_id: string
  readonly project_position: number
  readonly status: RunProjectWorktreeStatus
  readonly worktree_path: string
  readonly error_message: string | null
  readonly prepared_at: string | null
  readonly updated_at: string
}

const CreateRunProjectInputSchema = z
  .strictObject({
    projectId: ProjectIdSchema,
    name: z.string().trim().min(1).max(256),
    repositoryPath: z.string().trim().min(1).max(4_096),
    baseSha: GitShaSchema,
    sourceBranch: z.string().trim().min(1).max(512).nullable(),
  })
  .refine(({ repositoryPath }) => isAbsolute(repositoryPath), {
    message: 'Project repository path must be absolute',
    path: ['repositoryPath'],
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

const mapRunProject = (row: RunProjectRow): RunProjectSnapshot => ({
  projectId: ProjectIdSchema.parse(row.project_id),
  position: row.project_position,
  name: row.name,
  repositoryPath: row.repository_path,
  baseSha: GitShaSchema.parse(row.base_sha),
  sourceBranch: row.source_branch,
  isPrimary: row.is_primary === 1,
})

const mapRunProjectWorktree = (row: RunProjectWorktreeRow): RunProjectWorktree => ({
  projectId: ProjectIdSchema.parse(row.project_id),
  position: row.project_position,
  status: row.status,
  worktreePath: row.worktree_path,
  errorMessage: row.error_message,
  preparedAt: row.prepared_at,
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

  const listRunProjects = (runIdInput: RunId): readonly RunProjectSnapshot[] => {
    const runId = RunIdSchema.parse(runIdInput)
    const rows = connection
      .prepare(
        `SELECT project_id, project_position, name, repository_path,
                base_sha, source_branch, is_primary
         FROM run_projects
         WHERE run_id = ?
         ORDER BY project_position`,
      )
      .all(runId) as RunProjectRow[]
    return rows.map(mapRunProject)
  }

  const listRunProjectWorktrees = (runIdInput: RunId): readonly RunProjectWorktree[] => {
    const runId = RunIdSchema.parse(runIdInput)
    const rows = connection
      .prepare(
        `SELECT worktree.project_id, project.project_position,
                worktree.status, worktree.worktree_path,
                worktree.error_message, worktree.prepared_at, worktree.updated_at
         FROM run_project_worktrees AS worktree
         JOIN run_projects AS project
           ON project.run_id = worktree.run_id
          AND project.project_id = worktree.project_id
         WHERE worktree.run_id = ?
         ORDER BY project.project_position`,
      )
      .all(runId) as RunProjectWorktreeRow[]
    return rows.map(mapRunProjectWorktree)
  }

  const getRunProjectWorktree = (
    runId: RunId,
    projectId: ProjectId,
  ): RunProjectWorktree | undefined =>
    listRunProjectWorktrees(runId).find((worktree) => worktree.projectId === projectId)

  const requireRunProjectWorktree = (runId: RunId, projectId: ProjectId): RunProjectWorktree => {
    const worktree = getRunProjectWorktree(runId, projectId)
    if (worktree === undefined) {
      throw new PersistenceError({
        code: 'PERSISTENCE_NOT_FOUND',
        message: 'Run project worktree was not found',
        details: { runId, projectId },
      })
    }
    return worktree
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
      if (!Array.isArray(input.projects)) {
        throw validationFailure('Run project snapshot is required')
      }
      const projects = input.projects.map((project) =>
        parseInput(CreateRunProjectInputSchema, project, 'Run project snapshot is invalid'),
      )
      const configuredProjectIds = workflowSnapshot.configuration.projectIds
      if (
        projects.length !== configuredProjectIds.length ||
        projects.some((project, position) => project.projectId !== configuredProjectIds[position])
      ) {
        throw validationFailure('Run project snapshot does not match the workflow project order')
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
            const insertProject = connection.prepare(
              `INSERT INTO run_projects (
                 run_id, project_id, project_position, name, repository_path,
                 base_sha, source_branch, is_primary
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            for (const [position, project] of projects.entries()) {
              insertProject.run(
                runId,
                project.projectId,
                position,
                project.name,
                project.repositoryPath,
                project.baseSha,
                project.sourceBranch,
                project.projectId === workflowSnapshot.configuration.primaryProjectId ? 1 : 0,
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

    listRunProjects,

    listRunProjectWorktrees,

    markRunProjectWorktreePreparing(input) {
      const runId = RunIdSchema.parse(input.runId)
      const projectId = ProjectIdSchema.parse(input.projectId)
      const worktreePath = requireNonBlank(input.worktreePath, 'worktreePath')
      const updatedAt = parseInput(timestamp, input.timestamp, 'Worktree timestamp is invalid')
      if (!isAbsolute(worktreePath)) {
        throw validationFailure('Run project worktree path must be absolute')
      }
      if (!listRunProjects(runId).some((project) => project.projectId === projectId)) {
        throw new PersistenceError({
          code: 'PERSISTENCE_NOT_FOUND',
          message: 'Run project was not found',
          details: { runId, projectId },
        })
      }
      const existing = getRunProjectWorktree(runId, projectId)
      if (existing !== undefined && existing.worktreePath !== worktreePath) {
        throw new PersistenceError({
          code: 'PERSISTENCE_CONFLICT',
          message: 'Run project worktree path cannot be changed',
          details: { runId, projectId, worktreePath, existingPath: existing.worktreePath },
        })
      }
      if (existing?.status === 'READY') return existing

      try {
        connection
          .prepare(
            `INSERT INTO run_project_worktrees (
               run_id, project_id, status, worktree_path, error_message,
               prepared_at, updated_at
             ) VALUES (?, ?, 'PREPARING', ?, NULL, NULL, ?)
             ON CONFLICT (run_id, project_id) DO UPDATE SET
               status = 'PREPARING', error_message = NULL,
               prepared_at = NULL, updated_at = excluded.updated_at`,
          )
          .run(runId, projectId, worktreePath, updatedAt)
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not mark run project worktree as preparing')
      }
      return requireRunProjectWorktree(runId, projectId)
    },

    markRunProjectWorktreeReady(input) {
      const runId = RunIdSchema.parse(input.runId)
      const projectId = ProjectIdSchema.parse(input.projectId)
      const worktreePath = requireNonBlank(input.worktreePath, 'worktreePath')
      const updatedAt = parseInput(timestamp, input.timestamp, 'Worktree timestamp is invalid')
      const existing = requireRunProjectWorktree(runId, projectId)
      if (existing.worktreePath !== worktreePath) {
        throw new PersistenceError({
          code: 'PERSISTENCE_CONFLICT',
          message: 'Run project worktree path does not match its preparation',
          details: { runId, projectId, worktreePath, existingPath: existing.worktreePath },
        })
      }
      if (existing.status === 'READY') return existing
      if (existing.status !== 'PREPARING') {
        throw new PersistenceError({
          code: 'PERSISTENCE_CONFLICT',
          message: 'Only a preparing run project worktree can become ready',
          details: { runId, projectId, status: existing.status },
        })
      }
      try {
        connection
          .prepare(
            `UPDATE run_project_worktrees
             SET status = 'READY', error_message = NULL,
                 prepared_at = ?, updated_at = ?
             WHERE run_id = ? AND project_id = ? AND status = 'PREPARING'`,
          )
          .run(updatedAt, updatedAt, runId, projectId)
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not mark run project worktree as ready')
      }
      return requireRunProjectWorktree(runId, projectId)
    },

    markRunProjectWorktreeFailed(input) {
      const runId = RunIdSchema.parse(input.runId)
      const projectId = ProjectIdSchema.parse(input.projectId)
      const worktreePath = requireNonBlank(input.worktreePath, 'worktreePath')
      const errorMessage = parseInput(
        z.string().trim().min(1).max(4_096),
        input.errorMessage,
        'Worktree failure message is invalid',
      )
      const updatedAt = parseInput(timestamp, input.timestamp, 'Worktree timestamp is invalid')
      const existing = requireRunProjectWorktree(runId, projectId)
      if (existing.worktreePath !== worktreePath) {
        throw new PersistenceError({
          code: 'PERSISTENCE_CONFLICT',
          message: 'Run project worktree path does not match its preparation',
          details: { runId, projectId, worktreePath, existingPath: existing.worktreePath },
        })
      }
      try {
        connection
          .prepare(
            `UPDATE run_project_worktrees
             SET status = 'FAILED', error_message = ?,
                 prepared_at = NULL, updated_at = ?
             WHERE run_id = ? AND project_id = ?`,
          )
          .run(errorMessage, updatedAt, runId, projectId)
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not mark run project worktree as failed')
      }
      return requireRunProjectWorktree(runId, projectId)
    },
  }
}
