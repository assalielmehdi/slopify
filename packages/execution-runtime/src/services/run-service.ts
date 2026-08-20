import {
  ProjectProfileIdSchema,
  RevisionIdSchema,
  RunIdSchema,
  WorkflowIdSchema,
  type RunId,
} from '@loop/contracts'
import type { WorkflowRevision } from '@loop/workflow-model'
import { z } from 'zod'

import type { EventStore } from '../events/event-store.js'
import type { JsonValue } from '../persistence/json.js'
import type {
  ProfileRepository,
  ProjectProfileSnapshot,
} from '../persistence/profile-repository.js'
import type {
  DeliveryEvidence,
  NodeExecutionRecord,
  OutputChunk,
  PersistedArtifact,
  RepositorySelectionSnapshot,
  RunRecord,
  RunRepository,
  RunWorkspace,
} from '../persistence/run-repository.js'
import type { WorkflowRepository } from '../persistence/workflow-repository.js'
import type { ReadinessService } from './readiness-service.js'

export type RunServiceErrorCode =
  | 'NODE_NOT_FOUND'
  | 'NODE_SOURCE_UNAVAILABLE'
  | 'PROFILE_NOT_READY'
  | 'RUN_ACTIVE'
  | 'RUN_ADMISSION_CLOSED'
  | 'RUN_NOT_FOUND'
  | 'RUN_REQUEST_INVALID'
  | 'TASK_RESOLUTION_FAILED'
  | 'WORKFLOW_NOT_FOUND'

export class RunServiceError extends Error {
  override readonly name = 'RunServiceError'
  readonly activeRunId?: RunId

  constructor(
    readonly code: RunServiceErrorCode,
    message: string,
    options?: Readonly<{ activeRunId?: RunId; cause?: unknown }>,
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    if (options?.activeRunId !== undefined) this.activeRunId = options.activeRunId
  }
}

export interface RunTaskResolver {
  resolve(
    taskReference: string,
    context?: Readonly<{ clickupWorkspaceId: string }>,
  ): Promise<JsonValue>
}

export interface DeterministicNodeSource {
  readonly commandId: string
  readonly sourceFile: string
  readonly content: string
}

export interface NodeSourceProvider {
  get(commandId: string): DeterministicNodeSource | undefined
}

export interface RunNodeSource extends DeterministicNodeSource {
  readonly nodeId: string
}

export interface CreateRunServiceInput {
  readonly taskReference: string
  readonly workflowId: string
  readonly revisionId: string
  readonly profileId: string
  readonly notes?: string | undefined
}

export interface RunDetail {
  readonly run: RunRecord
  readonly workflowRevision: WorkflowRevision
  readonly profileSnapshot: ProjectProfileSnapshot
  readonly events: ReturnType<EventStore['list']>['events']
  readonly nodeExecutions: readonly NodeExecutionRecord[]
  readonly repositorySelection: RepositorySelectionSnapshot | null
  readonly workspaces: readonly RunWorkspace[]
  readonly deliveryEvidence: readonly DeliveryEvidence[]
  readonly outputChunks: readonly OutputChunk[]
  readonly artifacts: readonly PersistedArtifact[]
}

export interface RunSummary {
  readonly runId: RunId
  readonly workflowId: string
  readonly revisionId: string
  readonly profileSnapshotId: string
  readonly profileId: string
  readonly profileDisplayName: string
  readonly taskReference: string
  readonly notes: string | null
  readonly taskSnapshot: JsonValue
  readonly status: RunRecord['status']
  readonly currentNodeId: string | null
  readonly createdAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
  readonly durationMs: number | null
  readonly failedNodeId: string | null
  readonly mergeRequestUrls: readonly string[]
}

export interface RunSummaryPage {
  readonly data: readonly RunSummary[]
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly totalItems: number
    readonly totalPages: number
  }
}

export interface RunService {
  stopAdmissions(): void
  create(input: CreateRunServiceInput): Promise<RunRecord>
  get(runId: string): RunDetail | undefined
  list(input: { readonly page: number; readonly pageSize: number }): RunSummaryPage
  getNodeSource(runId: string, nodeId: string): RunNodeSource
}

export interface CreateRunServiceOptions {
  readonly events: EventStore
  readonly profiles: ProfileRepository
  readonly readiness: ReadinessService
  readonly runs: RunRepository
  readonly tasks: RunTaskResolver
  readonly workflows: WorkflowRepository
  readonly sources?: NodeSourceProvider
  readonly now?: () => string
  readonly createRunId?: () => string
  readonly createProfileSnapshotId?: () => string
}

const cloneJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

const duration = (run: RunRecord): number | null => {
  if (run.startedAt === null || run.completedAt === null) return null
  return Math.max(0, Date.parse(run.completedAt) - Date.parse(run.startedAt))
}

export const createRunService = (options: CreateRunServiceOptions): RunService => {
  const now = options.now ?? (() => new Date().toISOString())
  const createRunId = options.createRunId ?? (() => `run-${crypto.randomUUID()}`)
  const createProfileSnapshotId =
    options.createProfileSnapshotId ?? (() => `profile-snapshot-${crypto.randomUUID()}`)
  let acceptingRuns = true

  const requireAdmissionsOpen = (): void => {
    if (!acceptingRuns) {
      throw new RunServiceError('RUN_ADMISSION_CLOSED', 'Run admissions are closed')
    }
  }

  const requireNoActiveRun = (): void => {
    const active = options.runs.findActive()
    if (active !== undefined) {
      throw new RunServiceError('RUN_ACTIVE', 'Another run is already active', {
        activeRunId: active.runId,
      })
    }
  }

  return {
    stopAdmissions() {
      acceptingRuns = false
    },

    async create(input) {
      requireAdmissionsOpen()
      const workflowId = WorkflowIdSchema.parse(input.workflowId)
      const revisionId = RevisionIdSchema.parse(input.revisionId)
      const profileId = ProjectProfileIdSchema.parse(input.profileId)
      const taskReference = input.taskReference.trim()
      if (taskReference === '' || taskReference.length > 512) {
        throw new RunServiceError('TASK_RESOLUTION_FAILED', 'Task reference is invalid')
      }
      const notes = input.notes?.trim()
      if (notes !== undefined && (notes === '' || notes.length > 2_000)) {
        throw new RunServiceError('RUN_REQUEST_INVALID', 'Run notes are invalid')
      }
      requireNoActiveRun()
      const workflow = options.workflows.getRevision({ workflowId, revisionId })
      if (workflow === undefined) {
        throw new RunServiceError('WORKFLOW_NOT_FOUND', 'Workflow revision was not found')
      }
      const profile = options.profiles.get(profileId)
      if (profile === undefined) {
        throw new RunServiceError('PROFILE_NOT_READY', 'Project profile is not ready')
      }
      const readiness = await options.readiness.check(profileId)
      if (!readiness.ready) {
        throw new RunServiceError('PROFILE_NOT_READY', 'Project profile is not ready')
      }
      let taskSnapshot: JsonValue
      try {
        taskSnapshot = z.json().parse(
          await options.tasks.resolve(taskReference, {
            clickupWorkspaceId: profile.clickupWorkspaceId,
          }),
        )
      } catch (cause) {
        throw new RunServiceError('TASK_RESOLUTION_FAILED', 'Task could not be resolved', { cause })
      }

      requireAdmissionsOpen()
      requireNoActiveRun()
      const runId = RunIdSchema.parse(createRunId())
      const profileSnapshot = options.profiles.createSnapshot({
        snapshotId: createProfileSnapshotId(),
        profileId,
        createdAt: now(),
      })
      return options.runs.create({
        runId,
        workflowId,
        revisionId,
        profileSnapshotId: profileSnapshot.snapshotId,
        taskReference,
        ...(notes === undefined ? {} : { notes }),
        taskSnapshot,
        effectiveConfiguration: cloneJson(workflow),
        createdAt: now(),
      })
    },

    get(runIdInput) {
      const runId = RunIdSchema.parse(runIdInput)
      const run = options.runs.get(runId)
      if (run === undefined) return undefined
      const workflowRevision = options.workflows.getRevision({
        workflowId: run.workflowId,
        revisionId: run.revisionId,
      })
      const profileSnapshot = options.profiles.getSnapshot(run.profileSnapshotId)
      if (workflowRevision === undefined || profileSnapshot === undefined) return undefined
      const events = []
      let afterSequence = 0
      while (true) {
        const page = options.events.list({ runId, afterSequence, limit: 1_000 })
        events.push(...page.events)
        if (page.nextAfterSequence === null) break
        afterSequence = page.nextAfterSequence
      }
      return {
        run,
        workflowRevision,
        profileSnapshot,
        events,
        nodeExecutions: options.runs.listNodeExecutions(runId),
        repositorySelection: options.runs.getRepositorySelection(runId) ?? null,
        workspaces: options.runs.listWorkspaces(runId),
        deliveryEvidence: options.runs.listDeliveryEvidence(runId),
        outputChunks: options.runs.listOutputChunks(runId),
        artifacts: options.runs.listArtifacts(runId),
      }
    },

    list(input) {
      const page = options.runs.list(input)
      return {
        pagination: page.pagination,
        data: page.data.map((run) => {
          const profile = options.profiles.getSnapshot(run.profileSnapshotId)
          if (profile === undefined) {
            throw new RunServiceError('PROFILE_NOT_READY', 'Run profile snapshot was not found')
          }
          const nodeExecutions = options.runs.listNodeExecutions(run.runId)
          const failedNode = [...nodeExecutions]
            .reverse()
            .find(({ status }) => status === 'FAILED' || status === 'CANCELLED')
          return {
            runId: run.runId,
            workflowId: run.workflowId,
            revisionId: run.revisionId,
            profileSnapshotId: run.profileSnapshotId,
            profileId: profile.profileId,
            profileDisplayName: profile.displayName,
            taskReference: run.taskReference,
            notes: run.notes,
            taskSnapshot: run.taskSnapshot,
            status: run.status,
            currentNodeId: run.currentNodeId,
            createdAt: run.createdAt,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            durationMs: duration(run),
            failedNodeId: failedNode?.nodeId ?? null,
            mergeRequestUrls: options.runs
              .listDeliveryEvidence(run.runId)
              .flatMap(({ mergeRequestUrl }) =>
                mergeRequestUrl === null ? [] : [mergeRequestUrl],
              ),
          }
        }),
      }
    },

    getNodeSource(runIdInput, nodeId) {
      const runId = RunIdSchema.parse(runIdInput)
      const run = options.runs.get(runId)
      if (run === undefined) throw new RunServiceError('RUN_NOT_FOUND', 'Run was not found')
      const workflow = options.workflows.getRevision({
        workflowId: run.workflowId,
        revisionId: run.revisionId,
      })
      const node = workflow?.nodes.find((candidate) => candidate.id === nodeId)
      if (node === undefined) {
        throw new RunServiceError('NODE_NOT_FOUND', 'Run node was not found')
      }
      if (node.type !== 'command') {
        throw new RunServiceError(
          'NODE_SOURCE_UNAVAILABLE',
          'Deterministic node source is unavailable',
        )
      }
      const source = options.sources?.get(node.commandId)
      if (
        source === undefined ||
        source.commandId !== node.commandId ||
        source.sourceFile.trim() === '' ||
        source.sourceFile.length > 4_096 ||
        source.content.length > 262_144
      ) {
        throw new RunServiceError(
          'NODE_SOURCE_UNAVAILABLE',
          'Deterministic node source is unavailable',
        )
      }
      return { nodeId: node.id, ...source }
    },
  }
}
