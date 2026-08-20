import {
  ArtifactIdSchema,
  ArtifactTypeSchema,
  NodeIdSchema,
  OutcomeNameSchema,
  ProjectProfileIdSchema,
  RepositoryIdSchema,
  RevisionIdSchema,
  RunIdSchema,
  RunStatusSchema,
  WorkflowIdSchema,
  type ArtifactId,
  type ArtifactType,
  type RepositoryId,
  type RunEvent,
  type RunId,
  type RunStatus,
} from '@loop/contracts'

import { appendEvent } from '../events/event-store.js'
import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'
import { mapPersistenceError, PersistenceError } from './errors.js'
import { parseJson, serializeJson, type JsonValue } from './json.js'

export interface RunRecord {
  readonly runId: RunId
  readonly workflowId: string
  readonly revisionId: string
  readonly profileSnapshotId: string
  readonly taskReference: string
  readonly notes: string | null
  readonly taskSnapshot: JsonValue
  readonly effectiveConfiguration: JsonValue
  readonly status: RunStatus
  readonly currentNodeId: string | null
  readonly transitionCount: number
  readonly createdAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
}

export interface CreateRunInput {
  readonly runId: string
  readonly workflowId: string
  readonly revisionId: string
  readonly profileSnapshotId: string
  readonly taskReference: string
  readonly notes?: string
  readonly taskSnapshot: JsonValue
  readonly effectiveConfiguration: JsonValue
  readonly createdAt: string
}

export interface ListRunsInput {
  readonly page: number
  readonly pageSize: number
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

export interface ChangeRunStatusInput {
  readonly runId: RunId
  readonly expectedStatus: RunStatus
  readonly status: RunStatus
  readonly timestamp: string
}

export interface RequestRunCancellationInput {
  readonly runId: RunId
  readonly reason?: string
  readonly timestamp: string
}

export interface StartNodeInput {
  readonly runId: RunId
  readonly nodeExecutionId: string
  readonly nodeId: string
  readonly inputReferences: JsonValue
  readonly timestamp: string
}

export interface RecordOutputInput {
  readonly runId: RunId
  readonly nodeExecutionId: string
  readonly nodeId: string
  readonly channel: 'stdout' | 'stderr' | 'agent'
  readonly content: string
  readonly repositoryId?: string
  readonly timestamp: string
}

export interface RecordArtifactInput {
  readonly artifactId: string
  readonly runId: RunId
  readonly nodeExecutionId: string
  readonly nodeId: string
  readonly artifactType: ArtifactType
  readonly content: string
  readonly metadata: JsonValue
  readonly timestamp: string
}

export interface UpdateArtifactInput {
  readonly artifactId: string
  readonly runId: RunId
  readonly nodeExecutionId: string
  readonly nodeId: string
  readonly artifactType: 'REVIEW_SUMMARY'
  readonly content: string
  readonly metadata: JsonValue
  readonly timestamp: string
}

export interface CompleteNodeInput {
  readonly runId: RunId
  readonly nodeExecutionId: string
  readonly nodeId: string
  readonly outcome: string
  readonly durationMs: number
  readonly artifactIds: readonly string[]
  readonly output: JsonValue
  readonly timestamp: string
}

export interface CompleteNodeAndSelectEdgeInput extends CompleteNodeInput {
  readonly targetNodeId: string
}

export interface CompletedNodeRoute {
  readonly completionEvent: RunEvent
  readonly edgeEvent: RunEvent
  readonly transitionCount: number
}

export interface FailNodeAndRunInput {
  readonly runId: RunId
  readonly nodeExecutionId: string
  readonly nodeId: string
  readonly nodeStatus: 'FAILED' | 'CANCELLED'
  readonly runStatus: 'FAILED' | 'CANCELLED' | 'INTERRUPTED'
  readonly code: string
  readonly message: string
  readonly nodeDurationMs: number
  readonly runDurationMs: number
  readonly timestamp: string
}

export interface CompleteRunInput {
  readonly runId: RunId
  readonly expectedStatus: RunStatus
  readonly status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED'
  readonly durationMs: number
  readonly timestamp: string
}

export interface SelectedRepositoryInput {
  readonly repositoryId: string
  readonly rationale: string
  readonly responsibility: string
}

export interface ExcludedRepositoryInput {
  readonly repositoryId: string
  readonly rationale: string
}

export interface RepositorySelectionInput {
  readonly selected: readonly SelectedRepositoryInput[]
  readonly excluded: readonly ExcludedRepositoryInput[]
}

export interface SelectRepositoriesInput {
  readonly runId: RunId
  readonly selection: RepositorySelectionInput
  readonly selectedAt: string
}

export interface PersistedRepositorySelection {
  readonly repositoryId: RepositoryId
  readonly profilePosition: number
  readonly rationale: string
  readonly responsibility: string
}

export interface PersistedExcludedRepository {
  readonly repositoryId: RepositoryId
  readonly rationale: string
}

export interface RepositorySelectionSnapshot {
  readonly selected: readonly Omit<PersistedRepositorySelection, 'profilePosition'>[]
  readonly excluded: readonly PersistedExcludedRepository[]
}

export interface RecordWorkspaceInput {
  readonly runId: RunId
  readonly repositoryId: string
  readonly repositoryPath: string
  readonly worktreePath: string
  readonly remote: string
  readonly targetBranch: string
  readonly sourceBranch: string
  readonly baseSha: string
  readonly createdAt: string
}

export type DeliveryEvidenceStatus =
  'PENDING' | 'BRANCH_PUSHED' | 'MERGE_REQUEST_CREATED' | 'VERIFIED' | 'FAILED'

export interface UpsertDeliveryEvidenceInput {
  readonly runId: RunId
  readonly repositoryId: string
  readonly status: DeliveryEvidenceStatus
  readonly gitlabProject?: string
  readonly mergeRequestIid?: number
  readonly mergeRequestUrl?: string
  readonly sourceBranch?: string
  readonly targetBranch?: string
  readonly headSha?: string
  readonly evidence: JsonValue
  readonly updatedAt: string
}

export interface DeliveryEvidence {
  readonly repositoryId: RepositoryId
  readonly profilePosition: number
  readonly status: DeliveryEvidenceStatus
  readonly gitlabProject: string | null
  readonly mergeRequestIid: number | null
  readonly mergeRequestUrl: string | null
  readonly sourceBranch: string | null
  readonly targetBranch: string | null
  readonly headSha: string | null
  readonly evidence: JsonValue
  readonly updatedAt: string
}

export interface OutputChunk {
  readonly sequence: number
  readonly eventSequence: number
  readonly nodeExecutionId: string
  readonly channel: 'stdout' | 'stderr' | 'agent'
  readonly repositoryId: RepositoryId | null
  readonly content: string
  readonly createdAt: string
}

export interface PersistedArtifact {
  readonly artifactId: ArtifactId
  readonly nodeExecutionId: string
  readonly artifactType: ArtifactType
  readonly content: string
  readonly metadata: JsonValue
  readonly createdAt: string
}

export interface NodeExecutionRecord {
  readonly nodeExecutionId: string
  readonly nodeId: string
  readonly executionIndex: number
  readonly status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'SKIPPED'
  readonly inputReferences: JsonValue
  readonly output: JsonValue | null
  readonly outcome: string | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly selectedTargetNodeId: string | null
  readonly startedAt: string | null
  readonly completedAt: string | null
  readonly durationMs: number | null
}

export interface RunWorkspace {
  readonly repositoryId: RepositoryId
  readonly profilePosition: number
  readonly repositoryPath: string
  readonly worktreePath: string
  readonly remote: string
  readonly targetBranch: string
  readonly sourceBranch: string
  readonly baseSha: string
  readonly createdAt: string
}

export interface RunRepository {
  create(input: CreateRunInput): RunRecord
  get(runId: RunId): RunRecord | undefined
  findActive(): RunRecord | undefined
  list(input: ListRunsInput): RunPage
  changeStatus(input: ChangeRunStatusInput): RunEvent
  requestCancellation(input: RequestRunCancellationInput): RunEvent
  startNode(input: StartNodeInput): RunEvent
  recordOutput(input: RecordOutputInput): RunEvent
  recordArtifact(input: RecordArtifactInput): RunEvent
  updateArtifact(input: UpdateArtifactInput): RunEvent
  completeNode(input: CompleteNodeInput): RunEvent
  completeNodeAndSelectEdge(input: CompleteNodeAndSelectEdgeInput): CompletedNodeRoute
  failNodeAndRun(input: FailNodeAndRunInput): RunRecord
  completeRun(input: CompleteRunInput): RunRecord
  selectRepositories(input: SelectRepositoriesInput): readonly PersistedRepositorySelection[]
  listSelections(runId: RunId): readonly PersistedRepositorySelection[]
  getRepositorySelection(runId: RunId): RepositorySelectionSnapshot | undefined
  recordWorkspace(input: RecordWorkspaceInput): void
  upsertDeliveryEvidence(input: UpsertDeliveryEvidenceInput): void
  listDeliveryEvidence(runId: RunId): readonly DeliveryEvidence[]
  listNodeExecutions(runId: RunId): readonly NodeExecutionRecord[]
  listWorkspaces(runId: RunId): readonly RunWorkspace[]
  listOutputChunks(runId: RunId): readonly OutputChunk[]
  listArtifacts(runId: RunId): readonly PersistedArtifact[]
}

interface RunRow {
  readonly run_id: string
  readonly workflow_id: string
  readonly revision_id: string
  readonly profile_snapshot_id: string
  readonly task_reference: string
  readonly notes: string | null
  readonly task_snapshot_json: string
  readonly effective_configuration_json: string
  readonly status: string
  readonly current_node_id: string | null
  readonly transition_count: number
  readonly created_at: string
  readonly started_at: string | null
  readonly completed_at: string | null
}

interface RunStatusRow {
  readonly status: string
  readonly started_at: string | null
  readonly completed_at: string | null
}

interface ProfileSnapshotReferenceRow {
  readonly profile_snapshot_id: string
  readonly profile_id?: string
}

interface CandidateRepositoryRow {
  readonly repository_id: string
  readonly profile_position: number
}

interface SelectionRow extends CandidateRepositoryRow {
  readonly rationale: string
  readonly responsibility: string
}

interface RepositorySelectionSnapshotRow {
  readonly selection_json: string
}

interface StoredRepositorySelection {
  readonly selected: readonly {
    readonly repositoryId: string
    readonly rationale: string
    readonly responsibility: string
  }[]
  readonly excluded: readonly {
    readonly repositoryId: string
    readonly rationale: string
  }[]
}

interface DeliveryEvidenceRow extends CandidateRepositoryRow {
  readonly status: DeliveryEvidenceStatus
  readonly gitlab_project: string | null
  readonly merge_request_iid: number | null
  readonly merge_request_url: string | null
  readonly source_branch: string | null
  readonly target_branch: string | null
  readonly head_sha: string | null
  readonly evidence_json: string
  readonly updated_at: string
}

interface OutputChunkRow {
  readonly sequence: number
  readonly event_sequence: number
  readonly node_execution_id: string
  readonly channel: OutputChunk['channel']
  readonly repository_id: string | null
  readonly content: string
  readonly created_at: string
}

interface ArtifactRow {
  readonly artifact_id: string
  readonly node_execution_id: string
  readonly artifact_type: ArtifactType
  readonly content: string
  readonly metadata_json: string
  readonly created_at: string
}

interface NodeExecutionRow {
  readonly node_execution_id: string
  readonly node_id: string
  readonly execution_index: number
  readonly status: NodeExecutionRecord['status']
  readonly input_references_json: string
  readonly output_json: string | null
  readonly outcome: string | null
  readonly error_code: string | null
  readonly error_message: string | null
  readonly selected_target_node_id: string | null
  readonly started_at: string | null
  readonly completed_at: string | null
  readonly duration_ms: number | null
}

interface WorkspaceRow extends CandidateRepositoryRow {
  readonly repository_path: string
  readonly worktree_path: string
  readonly remote: string
  readonly target_branch: string
  readonly source_branch: string
  readonly base_sha: string
  readonly created_at: string
}

const requireNonBlank = (value: string, field: string): string => {
  if (value.trim() === '') {
    throw new PersistenceError({
      code: 'PERSISTENCE_VALIDATION_FAILED',
      message: `${field} must not be blank`,
      details: { field },
    })
  }
  return value
}

const mapRun = (row: RunRow): RunRecord => ({
  runId: RunIdSchema.parse(row.run_id),
  workflowId: WorkflowIdSchema.parse(row.workflow_id),
  revisionId: RevisionIdSchema.parse(row.revision_id),
  profileSnapshotId: row.profile_snapshot_id,
  taskReference: row.task_reference,
  notes: row.notes,
  taskSnapshot: parseJson(row.task_snapshot_json),
  effectiveConfiguration: parseJson(row.effective_configuration_json),
  status: RunStatusSchema.parse(row.status),
  currentNodeId: row.current_node_id,
  transitionCount: row.transition_count,
  createdAt: row.created_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
})

const terminalStatuses = new Set<RunStatus>(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'])

export const createRunRepository = (database: WorkbenchDatabase): RunRepository => {
  const connection = getDatabaseHandle(database)

  const get = (runIdInput: RunId): RunRecord | undefined => {
    const runId = RunIdSchema.parse(runIdInput)
    const row = connection
      .prepare(
        `SELECT run_id, workflow_id, revision_id, profile_snapshot_id,
                task_reference, notes, task_snapshot_json, effective_configuration_json,
                status, current_node_id, transition_count, created_at,
                started_at, completed_at
         FROM runs
         WHERE run_id = ?`,
      )
      .get(runId) as RunRow | undefined
    return row === undefined ? undefined : mapRun(row)
  }

  const findActive = (): RunRecord | undefined => {
    const row = connection
      .prepare(
        `SELECT run_id, workflow_id, revision_id, profile_snapshot_id,
                task_reference, notes, task_snapshot_json, effective_configuration_json,
                status, current_node_id, transition_count, created_at,
                started_at, completed_at
         FROM runs
         WHERE status IN ('PENDING', 'RUNNING')
         ORDER BY CASE status WHEN 'RUNNING' THEN 0 ELSE 1 END, created_at DESC, run_id DESC
         LIMIT 1`,
      )
      .get() as RunRow | undefined
    return row === undefined ? undefined : mapRun(row)
  }

  const listSelections = (runIdInput: RunId): readonly PersistedRepositorySelection[] => {
    const runId = RunIdSchema.parse(runIdInput)
    const rows = connection
      .prepare(
        `SELECT repository_id, profile_position, rationale, responsibility
         FROM run_repository_selections
         WHERE run_id = ?
         ORDER BY profile_position`,
      )
      .all(runId) as SelectionRow[]
    return rows.map((row) => ({
      repositoryId: RepositoryIdSchema.parse(row.repository_id),
      profilePosition: row.profile_position,
      rationale: row.rationale,
      responsibility: row.responsibility,
    }))
  }

  const getRepositorySelection = (runIdInput: RunId): RepositorySelectionSnapshot | undefined => {
    const runId = RunIdSchema.parse(runIdInput)
    const row = connection
      .prepare(
        `SELECT selection_json
         FROM run_repository_selection_snapshots
         WHERE run_id = ?`,
      )
      .get(runId) as RepositorySelectionSnapshotRow | undefined
    if (row === undefined) return undefined

    const selection = parseJson(row.selection_json) as unknown as StoredRepositorySelection
    return {
      selected: selection.selected.map((repository) => ({
        repositoryId: RepositoryIdSchema.parse(repository.repositoryId),
        rationale: repository.rationale,
        responsibility: repository.responsibility,
      })),
      excluded: selection.excluded.map((repository) => ({
        repositoryId: RepositoryIdSchema.parse(repository.repositoryId),
        rationale: repository.rationale,
      })),
    }
  }

  return {
    create(input) {
      const runId = RunIdSchema.parse(input.runId)
      const workflowId = WorkflowIdSchema.parse(input.workflowId)
      const revisionId = RevisionIdSchema.parse(input.revisionId)
      requireNonBlank(input.profileSnapshotId, 'profileSnapshotId')
      requireNonBlank(input.taskReference, 'taskReference')
      const taskSnapshotJson = serializeJson(input.taskSnapshot, 'taskSnapshot')
      const effectiveConfigurationJson = serializeJson(
        input.effectiveConfiguration,
        'effectiveConfiguration',
      )

      try {
        connection
          .transaction(() => {
            const snapshot = connection
              .prepare(
                `SELECT profile_id
                 FROM project_profile_snapshots
                 WHERE snapshot_id = ?`,
              )
              .get(input.profileSnapshotId) as ProfileSnapshotReferenceRow | undefined
            if (snapshot?.profile_id === undefined) {
              throw new PersistenceError({
                code: 'PERSISTENCE_NOT_FOUND',
                message: 'Project profile snapshot was not found',
                details: { profileSnapshotId: input.profileSnapshotId },
              })
            }

            connection
              .prepare(
                `INSERT INTO runs (
                   run_id, workflow_id, revision_id, profile_snapshot_id,
                   task_reference, notes, task_snapshot_json, effective_configuration_json,
                   status, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
              )
              .run(
                runId,
                workflowId,
                revisionId,
                input.profileSnapshotId,
                input.taskReference,
                input.notes ?? null,
                taskSnapshotJson,
                effectiveConfigurationJson,
                input.createdAt,
              )
            appendEvent(connection, runId, {
              type: 'RUN_STARTED',
              timestamp: input.createdAt,
              data: {
                workflowId,
                revisionId,
                profileId: ProjectProfileIdSchema.parse(snapshot.profile_id),
                taskReference: input.taskReference,
              },
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

    findActive,

    list(input) {
      if (
        !Number.isSafeInteger(input.page) ||
        input.page < 1 ||
        !Number.isSafeInteger(input.pageSize) ||
        input.pageSize < 1 ||
        input.pageSize > 100
      ) {
        throw new PersistenceError({
          code: 'PERSISTENCE_VALIDATION_FAILED',
          message: 'Run pagination is outside the supported range',
          details: { page: input.page, pageSize: input.pageSize },
        })
      }
      const totalItems = connection.prepare('SELECT COUNT(*) FROM runs').pluck().get()
      if (typeof totalItems !== 'number') {
        throw new PersistenceError({
          code: 'PERSISTENCE_READ_FAILED',
          message: 'Run count could not be read',
        })
      }
      const rows = connection
        .prepare(
          `SELECT run_id, workflow_id, revision_id, profile_snapshot_id,
                  task_reference, notes, task_snapshot_json, effective_configuration_json,
                  status, current_node_id, transition_count, created_at,
                  started_at, completed_at
           FROM runs
           ORDER BY created_at DESC, run_id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(input.pageSize, (input.page - 1) * input.pageSize) as RunRow[]
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

    changeStatus(input) {
      const runId = RunIdSchema.parse(input.runId)
      const expectedStatus = RunStatusSchema.parse(input.expectedStatus)
      const status = RunStatusSchema.parse(input.status)
      try {
        return connection
          .transaction(() => {
            const existing = connection
              .prepare('SELECT status, started_at, completed_at FROM runs WHERE run_id = ?')
              .get(runId) as RunStatusRow | undefined
            if (existing === undefined) {
              throw new PersistenceError({
                code: 'PERSISTENCE_NOT_FOUND',
                message: 'Run was not found',
                details: { runId },
              })
            }
            if (existing.status !== expectedStatus) {
              throw new PersistenceError({
                code: 'PERSISTENCE_CONFLICT',
                message: 'Run status does not match the expected state',
                details: { runId, expectedStatus, actualStatus: existing.status },
              })
            }

            const startedAt = status === 'RUNNING' ? input.timestamp : existing.started_at
            const completedAt = terminalStatuses.has(status)
              ? input.timestamp
              : existing.completed_at
            connection
              .prepare(
                `UPDATE runs
                 SET status = ?, started_at = ?, completed_at = ?
                 WHERE run_id = ?`,
              )
              .run(status, startedAt, completedAt, runId)
            return appendEvent(connection, runId, {
              type: 'RUN_STATUS_CHANGED',
              timestamp: input.timestamp,
              data: { from: expectedStatus, to: status },
            })
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not change run status')
      }
    },

    requestCancellation(input) {
      const runId = RunIdSchema.parse(input.runId)
      try {
        return connection
          .transaction(() => {
            const status = connection
              .prepare('SELECT status FROM runs WHERE run_id = ?')
              .pluck()
              .get(runId)
            if (status === undefined) {
              throw new PersistenceError({
                code: 'PERSISTENCE_NOT_FOUND',
                message: 'Run was not found',
                details: { runId },
              })
            }
            if (status !== 'RUNNING') {
              throw new PersistenceError({
                code: 'PERSISTENCE_CONFLICT',
                message: 'Run is not running',
                details: { runId, status },
              })
            }
            return appendEvent(connection, runId, {
              type: 'RUN_CANCEL_REQUESTED',
              timestamp: input.timestamp,
              data: input.reason === undefined ? {} : { reason: input.reason },
            })
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not request run cancellation')
      }
    },

    startNode(input) {
      const runId = RunIdSchema.parse(input.runId)
      const nodeId = NodeIdSchema.parse(input.nodeId)
      requireNonBlank(input.nodeExecutionId, 'nodeExecutionId')
      const inputReferencesJson = serializeJson(input.inputReferences, 'inputReferences')

      try {
        return connection
          .transaction(() => {
            const runStatus = connection
              .prepare('SELECT status FROM runs WHERE run_id = ?')
              .pluck()
              .get(runId)
            if (runStatus !== 'RUNNING') {
              throw new PersistenceError({
                code: runStatus === undefined ? 'PERSISTENCE_NOT_FOUND' : 'PERSISTENCE_CONFLICT',
                message:
                  runStatus === undefined
                    ? 'Run was not found'
                    : 'A node can start only while its run is running',
                details: { runId, status: runStatus },
              })
            }
            const executionIndex = connection
              .prepare(
                `SELECT COALESCE(MAX(execution_index), 0) + 1
                 FROM node_executions
                 WHERE run_id = ?`,
              )
              .pluck()
              .get(runId)
            if (typeof executionIndex !== 'number') {
              throw new PersistenceError({
                code: 'PERSISTENCE_WRITE_FAILED',
                message: 'Could not allocate node execution order',
              })
            }

            connection
              .prepare(
                `INSERT INTO node_executions (
                   node_execution_id, run_id, node_id, execution_index,
                   status, input_references_json, started_at
                 ) VALUES (?, ?, ?, ?, 'RUNNING', ?, ?)`,
              )
              .run(
                input.nodeExecutionId,
                runId,
                nodeId,
                executionIndex,
                inputReferencesJson,
                input.timestamp,
              )
            connection
              .prepare('UPDATE runs SET current_node_id = ? WHERE run_id = ?')
              .run(nodeId, runId)
            return appendEvent(
              connection,
              runId,
              { type: 'NODE_STARTED', nodeId, timestamp: input.timestamp, data: {} },
              input.nodeExecutionId,
            )
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not start node execution')
      }
    },

    recordOutput(input) {
      const runId = RunIdSchema.parse(input.runId)
      const nodeId = NodeIdSchema.parse(input.nodeId)
      const repositoryId =
        input.repositoryId === undefined ? undefined : RepositoryIdSchema.parse(input.repositoryId)

      try {
        return connection
          .transaction(() => {
            const event = appendEvent(
              connection,
              runId,
              {
                type: 'NODE_OUTPUT',
                nodeId,
                timestamp: input.timestamp,
                data: {
                  channel: input.channel,
                  content: input.content,
                  ...(repositoryId === undefined ? {} : { repositoryId }),
                },
              },
              input.nodeExecutionId,
            )
            const chunkSequence = connection
              .prepare(
                `SELECT COALESCE(MAX(sequence), 0) + 1
                 FROM output_chunks
                 WHERE run_id = ?`,
              )
              .pluck()
              .get(runId)
            if (typeof chunkSequence !== 'number') {
              throw new PersistenceError({
                code: 'PERSISTENCE_WRITE_FAILED',
                message: 'Could not allocate output chunk order',
              })
            }
            connection
              .prepare(
                `INSERT INTO output_chunks (
                   run_id, sequence, event_sequence, node_execution_id,
                   channel, repository_id, content, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                runId,
                chunkSequence,
                event.sequence,
                input.nodeExecutionId,
                input.channel,
                repositoryId ?? null,
                input.content,
                input.timestamp,
              )
            return event
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not persist node output')
      }
    },

    recordArtifact(input) {
      const artifactId = ArtifactIdSchema.parse(input.artifactId)
      const runId = RunIdSchema.parse(input.runId)
      const nodeId = NodeIdSchema.parse(input.nodeId)
      const artifactType = ArtifactTypeSchema.parse(input.artifactType)
      const metadataJson = serializeJson(input.metadata, 'metadata')

      try {
        return connection
          .transaction(() => {
            connection
              .prepare(
                `INSERT INTO artifacts (
                   artifact_id, run_id, node_execution_id, artifact_type,
                   content, metadata_json, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                artifactId,
                runId,
                input.nodeExecutionId,
                artifactType,
                input.content,
                metadataJson,
                input.timestamp,
              )
            return appendEvent(
              connection,
              runId,
              {
                type: 'ARTIFACT_RECORDED',
                nodeId,
                timestamp: input.timestamp,
                data: { artifactId, artifactType },
              },
              input.nodeExecutionId,
            )
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not persist artifact')
      }
    },

    updateArtifact(input) {
      const artifactId = ArtifactIdSchema.parse(input.artifactId)
      const runId = RunIdSchema.parse(input.runId)
      const nodeId = NodeIdSchema.parse(input.nodeId)
      const artifactType = ArtifactTypeSchema.parse(input.artifactType)
      const metadataJson = serializeJson(input.metadata, 'metadata')
      if (artifactType !== 'REVIEW_SUMMARY') {
        throw new PersistenceError({
          code: 'PERSISTENCE_VALIDATION_FAILED',
          message: 'Only review summaries support in-place history updates',
        })
      }

      try {
        return connection
          .transaction(() => {
            const updated = connection
              .prepare(
                `UPDATE artifacts
                 SET content = ?, metadata_json = ?
                 WHERE artifact_id = ? AND run_id = ? AND artifact_type = 'REVIEW_SUMMARY'`,
              )
              .run(input.content, metadataJson, artifactId, runId)
            if (updated.changes !== 1) {
              throw new PersistenceError({
                code: 'PERSISTENCE_WRITE_FAILED',
                message: 'Could not update the exact review summary',
              })
            }
            return appendEvent(
              connection,
              runId,
              {
                type: 'ARTIFACT_RECORDED',
                nodeId,
                timestamp: input.timestamp,
                data: { artifactId, artifactType, operation: 'updated' },
              },
              input.nodeExecutionId,
            )
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not update review summary')
      }
    },

    completeNode(input) {
      const runId = RunIdSchema.parse(input.runId)
      const nodeId = NodeIdSchema.parse(input.nodeId)
      const outcome = OutcomeNameSchema.parse(input.outcome)
      const artifactIds = input.artifactIds.map((artifactId) => ArtifactIdSchema.parse(artifactId))
      if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0) {
        throw new PersistenceError({
          code: 'PERSISTENCE_VALIDATION_FAILED',
          message: 'Node duration must be a non-negative safe integer',
          details: { field: 'durationMs' },
        })
      }
      const outputJson = serializeJson(input.output, 'output')

      try {
        return connection
          .transaction(() => {
            const result = connection
              .prepare(
                `UPDATE node_executions
                 SET status = 'SUCCEEDED', output_json = ?, outcome = ?,
                     completed_at = ?, duration_ms = ?
                 WHERE run_id = ? AND node_execution_id = ?
                   AND node_id = ? AND status = 'RUNNING'`,
              )
              .run(
                outputJson,
                outcome,
                input.timestamp,
                input.durationMs,
                runId,
                input.nodeExecutionId,
                nodeId,
              )
            if (result.changes !== 1) {
              throw new PersistenceError({
                code: 'PERSISTENCE_CONFLICT',
                message: 'Node execution is not running',
                details: { runId, nodeExecutionId: input.nodeExecutionId },
              })
            }
            return appendEvent(
              connection,
              runId,
              {
                type: 'NODE_COMPLETED',
                nodeId,
                timestamp: input.timestamp,
                data: { outcome, durationMs: input.durationMs, artifactIds },
              },
              input.nodeExecutionId,
            )
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not complete node execution')
      }
    },

    completeNodeAndSelectEdge(input) {
      const runId = RunIdSchema.parse(input.runId)
      const nodeId = NodeIdSchema.parse(input.nodeId)
      const targetNodeId = NodeIdSchema.parse(input.targetNodeId)
      const outcome = OutcomeNameSchema.parse(input.outcome)
      const artifactIds = input.artifactIds.map((artifactId) => ArtifactIdSchema.parse(artifactId))
      if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0) {
        throw new PersistenceError({
          code: 'PERSISTENCE_VALIDATION_FAILED',
          message: 'Node duration must be a non-negative safe integer',
          details: { field: 'durationMs' },
        })
      }
      const outputJson = serializeJson(input.output, 'output')

      try {
        return connection
          .transaction(() => {
            const nodeResult = connection
              .prepare(
                `UPDATE node_executions
                 SET status = 'SUCCEEDED', output_json = ?, outcome = ?,
                     selected_target_node_id = ?, completed_at = ?, duration_ms = ?
                 WHERE run_id = ? AND node_execution_id = ?
                   AND node_id = ? AND status = 'RUNNING'`,
              )
              .run(
                outputJson,
                outcome,
                targetNodeId,
                input.timestamp,
                input.durationMs,
                runId,
                input.nodeExecutionId,
                nodeId,
              )
            if (nodeResult.changes !== 1) {
              throw new PersistenceError({
                code: 'PERSISTENCE_CONFLICT',
                message: 'Node execution is not running',
                details: { runId, nodeExecutionId: input.nodeExecutionId },
              })
            }
            const runResult = connection
              .prepare(
                `UPDATE runs
                 SET current_node_id = ?, transition_count = transition_count + 1
                 WHERE run_id = ? AND status = 'RUNNING'`,
              )
              .run(targetNodeId, runId)
            if (runResult.changes !== 1) {
              throw new PersistenceError({
                code: 'PERSISTENCE_CONFLICT',
                message: 'Run is not running',
                details: { runId },
              })
            }

            const completionEvent = appendEvent(
              connection,
              runId,
              {
                type: 'NODE_COMPLETED',
                nodeId,
                timestamp: input.timestamp,
                data: { outcome, durationMs: input.durationMs, artifactIds },
              },
              input.nodeExecutionId,
            )
            const edgeEvent = appendEvent(
              connection,
              runId,
              {
                type: 'EDGE_SELECTED',
                nodeId,
                timestamp: input.timestamp,
                data: { outcome, targetNodeId },
              },
              input.nodeExecutionId,
            )
            const transitionCount = connection
              .prepare('SELECT transition_count FROM runs WHERE run_id = ?')
              .pluck()
              .get(runId)
            if (typeof transitionCount !== 'number') {
              throw new PersistenceError({
                code: 'PERSISTENCE_READ_FAILED',
                message: 'Updated run transition count could not be read',
              })
            }

            return { completionEvent, edgeEvent, transitionCount }
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not complete and route node execution')
      }
    },

    failNodeAndRun(input) {
      const runId = RunIdSchema.parse(input.runId)
      const nodeId = NodeIdSchema.parse(input.nodeId)
      if (
        !Number.isSafeInteger(input.nodeDurationMs) ||
        input.nodeDurationMs < 0 ||
        !Number.isSafeInteger(input.runDurationMs) ||
        input.runDurationMs < 0
      ) {
        throw new PersistenceError({
          code: 'PERSISTENCE_VALIDATION_FAILED',
          message: 'Failure durations must be non-negative safe integers',
        })
      }

      try {
        connection
          .transaction(() => {
            const nodeResult = connection
              .prepare(
                `UPDATE node_executions
                 SET status = ?, error_code = ?, error_message = ?,
                     completed_at = ?, duration_ms = ?
                 WHERE run_id = ? AND node_execution_id = ?
                   AND node_id = ? AND status = 'RUNNING'`,
              )
              .run(
                input.nodeStatus,
                input.code,
                input.message,
                input.timestamp,
                input.nodeDurationMs,
                runId,
                input.nodeExecutionId,
                nodeId,
              )
            if (nodeResult.changes !== 1) {
              throw new PersistenceError({
                code: 'PERSISTENCE_CONFLICT',
                message: 'Node execution is not running',
                details: { runId, nodeExecutionId: input.nodeExecutionId },
              })
            }
            const runResult = connection
              .prepare(
                `UPDATE runs
                 SET status = ?, completed_at = ?
                 WHERE run_id = ? AND status = 'RUNNING'`,
              )
              .run(input.runStatus, input.timestamp, runId)
            if (runResult.changes !== 1) {
              throw new PersistenceError({
                code: 'PERSISTENCE_CONFLICT',
                message: 'Run is not running',
                details: { runId },
              })
            }

            appendEvent(
              connection,
              runId,
              {
                type: 'NODE_FAILED',
                nodeId,
                timestamp: input.timestamp,
                data: {
                  code: input.code,
                  message: input.message,
                  durationMs: input.nodeDurationMs,
                },
              },
              input.nodeExecutionId,
            )
            appendEvent(connection, runId, {
              type: 'RUN_STATUS_CHANGED',
              timestamp: input.timestamp,
              data: { from: 'RUNNING', to: input.runStatus },
            })
            appendEvent(connection, runId, {
              type: 'RUN_COMPLETED',
              timestamp: input.timestamp,
              data: { status: input.runStatus, durationMs: input.runDurationMs },
            })
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not fail node execution and run')
      }

      const failedRun = get(runId)
      if (failedRun === undefined) {
        throw new PersistenceError({
          code: 'PERSISTENCE_READ_FAILED',
          message: 'Failed run could not be read',
        })
      }
      return failedRun
    },

    completeRun(input) {
      const runId = RunIdSchema.parse(input.runId)
      const expectedStatus = RunStatusSchema.parse(input.expectedStatus)
      if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0) {
        throw new PersistenceError({
          code: 'PERSISTENCE_VALIDATION_FAILED',
          message: 'Run duration must be a non-negative safe integer',
          details: { field: 'durationMs' },
        })
      }

      try {
        connection
          .transaction(() => {
            const result = connection
              .prepare(
                `UPDATE runs
                 SET status = ?, completed_at = ?
                 WHERE run_id = ? AND status = ?`,
              )
              .run(input.status, input.timestamp, runId, expectedStatus)
            if (result.changes !== 1) {
              throw new PersistenceError({
                code: 'PERSISTENCE_CONFLICT',
                message: 'Run status does not match the expected state',
                details: { runId, expectedStatus },
              })
            }
            appendEvent(connection, runId, {
              type: 'RUN_STATUS_CHANGED',
              timestamp: input.timestamp,
              data: { from: expectedStatus, to: input.status },
            })
            appendEvent(connection, runId, {
              type: 'RUN_COMPLETED',
              timestamp: input.timestamp,
              data: { status: input.status, durationMs: input.durationMs },
            })
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not complete run')
      }

      const completedRun = get(runId)
      if (completedRun === undefined) {
        throw new PersistenceError({
          code: 'PERSISTENCE_READ_FAILED',
          message: 'Completed run could not be read',
        })
      }
      return completedRun
    },

    selectRepositories(input) {
      const runId = RunIdSchema.parse(input.runId)
      if (input.selection.selected.length === 0) {
        throw new PersistenceError({
          code: 'PERSISTENCE_VALIDATION_FAILED',
          message: 'At least one repository must be selected',
          details: { field: 'selections' },
        })
      }
      const selected = input.selection.selected.map((repository) => ({
        repositoryId: RepositoryIdSchema.parse(repository.repositoryId),
        rationale: requireNonBlank(repository.rationale, 'selected.rationale'),
        responsibility: requireNonBlank(repository.responsibility, 'responsibility'),
      }))
      const excluded = input.selection.excluded.map((repository) => ({
        repositoryId: RepositoryIdSchema.parse(repository.repositoryId),
        rationale: requireNonBlank(repository.rationale, 'excluded.rationale'),
      }))
      const repositoryIds = [...selected, ...excluded].map(({ repositoryId }) => repositoryId)
      if (new Set(repositoryIds).size !== repositoryIds.length) {
        throw new PersistenceError({
          code: 'PERSISTENCE_VALIDATION_FAILED',
          message: 'Selected and excluded repository IDs must be unique',
          details: { field: 'selection' },
        })
      }

      try {
        connection
          .transaction(() => {
            const run = connection
              .prepare('SELECT profile_snapshot_id FROM runs WHERE run_id = ?')
              .get(runId) as ProfileSnapshotReferenceRow | undefined
            if (run === undefined) {
              throw new PersistenceError({
                code: 'PERSISTENCE_NOT_FOUND',
                message: 'Run was not found',
                details: { runId },
              })
            }
            const existingSelection = connection
              .prepare('SELECT 1 FROM run_repository_selection_snapshots WHERE run_id = ?')
              .get(runId)
            if (existingSelection !== undefined) {
              throw new PersistenceError({
                code: 'PERSISTENCE_CONFLICT',
                message: 'Run repository selection is immutable',
                details: { runId },
              })
            }

            const candidates = connection
              .prepare(
                `SELECT repository_id, profile_position
                 FROM profile_snapshot_repositories
                 WHERE snapshot_id = ?`,
              )
              .all(run.profile_snapshot_id) as CandidateRepositoryRow[]
            const candidatesById = new Map(
              candidates.map((candidate) => [candidate.repository_id, candidate]),
            )
            if (
              repositoryIds.length !== candidates.length ||
              repositoryIds.some((repositoryId) => !candidatesById.has(repositoryId))
            ) {
              throw new PersistenceError({
                code: 'PERSISTENCE_VALIDATION_FAILED',
                message: 'Repository selection must partition the profile snapshot exactly',
                details: { field: 'selection' },
              })
            }

            const byProfilePosition = <Repository extends { readonly repositoryId: string }>(
              left: Repository,
              right: Repository,
            ): number =>
              (candidatesById.get(left.repositoryId)?.profile_position ?? 0) -
              (candidatesById.get(right.repositoryId)?.profile_position ?? 0)
            const orderedSelected = [...selected].sort(byProfilePosition)
            const orderedExcluded = [...excluded].sort(byProfilePosition)
            const selectionSnapshot: JsonValue = {
              selected: orderedSelected.map((repository) => ({ ...repository })),
              excluded: orderedExcluded.map((repository) => ({ ...repository })),
            }
            connection
              .prepare(
                `INSERT INTO run_repository_selection_snapshots (
                   run_id, selection_json, selected_at
                 ) VALUES (?, ?, ?)`,
              )
              .run(runId, serializeJson(selectionSnapshot, 'selection'), input.selectedAt)

            const orderedSelections = orderedSelected.map((selection) => {
              const candidate = candidatesById.get(selection.repositoryId)
              if (candidate === undefined) {
                throw new PersistenceError({
                  code: 'PERSISTENCE_VALIDATION_FAILED',
                  message: 'Selected repository is not in the profile snapshot',
                  details: { repositoryId: selection.repositoryId },
                })
              }
              return { ...selection, profilePosition: candidate.profile_position }
            })
            const insert = connection.prepare(
              `INSERT INTO run_repository_selections (
                 run_id, profile_snapshot_id, repository_id, profile_position,
                 responsibility, selected_at, rationale
               ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            for (const selection of orderedSelections) {
              insert.run(
                runId,
                run.profile_snapshot_id,
                selection.repositoryId,
                selection.profilePosition,
                selection.responsibility,
                input.selectedAt,
                selection.rationale,
              )
            }
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not persist repository selection')
      }
      return listSelections(runId)
    },

    listSelections,

    getRepositorySelection,

    recordWorkspace(input) {
      const runId = RunIdSchema.parse(input.runId)
      const repositoryId = RepositoryIdSchema.parse(input.repositoryId)
      try {
        connection
          .prepare(
            `INSERT INTO run_workspaces (
               run_id, repository_id, repository_path, worktree_path, remote,
               target_branch, source_branch, base_sha, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            runId,
            repositoryId,
            input.repositoryPath,
            input.worktreePath,
            input.remote,
            input.targetBranch,
            input.sourceBranch,
            input.baseSha,
            input.createdAt,
          )
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not persist run workspace')
      }
    },

    upsertDeliveryEvidence(input) {
      const runId = RunIdSchema.parse(input.runId)
      const repositoryId = RepositoryIdSchema.parse(input.repositoryId)
      const evidenceJson = serializeJson(input.evidence, 'evidence')
      try {
        connection
          .prepare(
            `INSERT INTO repository_delivery_evidence (
               run_id, repository_id, status, gitlab_project, merge_request_iid,
               merge_request_url, source_branch, target_branch, head_sha,
               evidence_json, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (run_id, repository_id) DO UPDATE SET
               status = excluded.status,
               gitlab_project = excluded.gitlab_project,
               merge_request_iid = excluded.merge_request_iid,
               merge_request_url = excluded.merge_request_url,
               source_branch = excluded.source_branch,
               target_branch = excluded.target_branch,
               head_sha = excluded.head_sha,
               evidence_json = excluded.evidence_json,
               updated_at = excluded.updated_at`,
          )
          .run(
            runId,
            repositoryId,
            input.status,
            input.gitlabProject ?? null,
            input.mergeRequestIid ?? null,
            input.mergeRequestUrl ?? null,
            input.sourceBranch ?? null,
            input.targetBranch ?? null,
            input.headSha ?? null,
            evidenceJson,
            input.updatedAt,
          )
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not persist delivery evidence')
      }
    },

    listDeliveryEvidence(runIdInput) {
      const runId = RunIdSchema.parse(runIdInput)
      const rows = connection
        .prepare(
          `SELECT evidence.repository_id, selection.profile_position, evidence.status,
                  evidence.gitlab_project, evidence.merge_request_iid,
                  evidence.merge_request_url, evidence.source_branch,
                  evidence.target_branch, evidence.head_sha,
                  evidence.evidence_json, evidence.updated_at
           FROM repository_delivery_evidence AS evidence
           JOIN run_repository_selections AS selection
             ON selection.run_id = evidence.run_id
            AND selection.repository_id = evidence.repository_id
           WHERE evidence.run_id = ?
           ORDER BY selection.profile_position`,
        )
        .all(runId) as DeliveryEvidenceRow[]
      return rows.map((row) => ({
        repositoryId: RepositoryIdSchema.parse(row.repository_id),
        profilePosition: row.profile_position,
        status: row.status,
        gitlabProject: row.gitlab_project,
        mergeRequestIid: row.merge_request_iid,
        mergeRequestUrl: row.merge_request_url,
        sourceBranch: row.source_branch,
        targetBranch: row.target_branch,
        headSha: row.head_sha,
        evidence: parseJson(row.evidence_json),
        updatedAt: row.updated_at,
      }))
    },

    listNodeExecutions(runIdInput) {
      const runId = RunIdSchema.parse(runIdInput)
      const rows = connection
        .prepare(
          `SELECT node_execution_id, node_id, execution_index, status,
                  input_references_json, output_json, outcome, error_code,
                  error_message, selected_target_node_id, started_at,
                  completed_at, duration_ms
           FROM node_executions
           WHERE run_id = ?
           ORDER BY execution_index`,
        )
        .all(runId) as NodeExecutionRow[]
      return rows.map((row) => ({
        nodeExecutionId: row.node_execution_id,
        nodeId: NodeIdSchema.parse(row.node_id),
        executionIndex: row.execution_index,
        status: row.status,
        inputReferences: parseJson(row.input_references_json),
        output: row.output_json === null ? null : parseJson(row.output_json),
        outcome: row.outcome,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        selectedTargetNodeId: row.selected_target_node_id,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        durationMs: row.duration_ms,
      }))
    },

    listWorkspaces(runIdInput) {
      const runId = RunIdSchema.parse(runIdInput)
      const rows = connection
        .prepare(
          `SELECT workspace.repository_id, selection.profile_position,
                  workspace.repository_path, workspace.worktree_path,
                  workspace.remote, workspace.target_branch,
                  workspace.source_branch, workspace.base_sha,
                  workspace.created_at
           FROM run_workspaces AS workspace
           JOIN run_repository_selections AS selection
             ON selection.run_id = workspace.run_id
            AND selection.repository_id = workspace.repository_id
           WHERE workspace.run_id = ?
           ORDER BY selection.profile_position`,
        )
        .all(runId) as WorkspaceRow[]
      return rows.map((row) => ({
        repositoryId: RepositoryIdSchema.parse(row.repository_id),
        profilePosition: row.profile_position,
        repositoryPath: row.repository_path,
        worktreePath: row.worktree_path,
        remote: row.remote,
        targetBranch: row.target_branch,
        sourceBranch: row.source_branch,
        baseSha: row.base_sha,
        createdAt: row.created_at,
      }))
    },

    listOutputChunks(runIdInput) {
      const runId = RunIdSchema.parse(runIdInput)
      const rows = connection
        .prepare(
          `SELECT sequence, event_sequence, node_execution_id, channel,
                  repository_id, content, created_at
           FROM output_chunks
           WHERE run_id = ?
           ORDER BY sequence`,
        )
        .all(runId) as OutputChunkRow[]
      return rows.map((row) => ({
        sequence: row.sequence,
        eventSequence: row.event_sequence,
        nodeExecutionId: row.node_execution_id,
        channel: row.channel,
        repositoryId:
          row.repository_id === null ? null : RepositoryIdSchema.parse(row.repository_id),
        content: row.content,
        createdAt: row.created_at,
      }))
    },

    listArtifacts(runIdInput) {
      const runId = RunIdSchema.parse(runIdInput)
      const rows = connection
        .prepare(
          `SELECT artifact_id, node_execution_id, artifact_type,
                  content, metadata_json, created_at
           FROM artifacts
           WHERE run_id = ?
           ORDER BY created_at, artifact_id`,
        )
        .all(runId) as ArtifactRow[]
      return rows.map((row) => ({
        artifactId: ArtifactIdSchema.parse(row.artifact_id),
        nodeExecutionId: row.node_execution_id,
        artifactType: ArtifactTypeSchema.parse(row.artifact_type),
        content: row.content,
        metadata: parseJson(row.metadata_json),
        createdAt: row.created_at,
      }))
    },
  }
}
