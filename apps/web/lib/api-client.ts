import {
  ApiErrorSchema,
  ArtifactIdSchema,
  ArtifactTypeSchema,
  CancelRunRequestSchema,
  ConnectorStatusSchema,
  CreateRunRequestSchema,
  GitShaSchema,
  HealthResponseSchema,
  NodeIdSchema,
  NodeExecutionStatusSchema,
  OutcomeNameSchema,
  ProfileRepositoryConfigurationSchema,
  ProjectProfileCatalogResponseSchema,
  ProjectProfileConfigurationSchema,
  ProjectProfileReadinessSchema,
  RepositoryIdSchema,
  ResolveClickUpTaskRequestSchema,
  RevisionIdSchema,
  RunEventSchema,
  RunIdSchema,
  RunStatusSchema,
  WorkflowIdSchema,
  type ConnectorStatus,
  type HealthResponse,
  type ProjectProfileCatalogResponse,
  type ProjectProfileConfiguration,
  type ProjectProfileReadiness,
} from '@loop/contracts'
import {
  WorkflowRevisionSchema,
  type AgentNodeConfigurationChanges,
  type WorkflowRevision,
} from '@loop/workflow-model'
import { z } from 'zod'

const WorkflowRevisionSummarySchema = z.strictObject({
  revisionId: RevisionIdSchema,
  parentRevisionId: RevisionIdSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})

const WorkflowCatalogEntrySchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  name: z.string().trim().min(1),
  latestRevisionId: RevisionIdSchema,
  revisions: z.array(WorkflowRevisionSummarySchema).min(1).readonly(),
})

const WorkflowCatalogResponseSchema = z.strictObject({
  workflows: z.array(WorkflowCatalogEntrySchema).readonly(),
})

const ClickUpTaskSnapshotSchema = z.strictObject({
  taskId: z.string().trim().min(1).max(128),
  customTaskId: z.string().trim().min(1).max(128).nullable(),
  url: z.url().max(4_096),
  title: z.string().trim().min(1).max(10_000),
  description: z.string().max(1_000_000),
  status: z.strictObject({
    id: z.string().trim().min(1).max(128).nullable(),
    name: z.string().trim().min(1).max(256),
    type: z.string().trim().min(1).max(128).nullable(),
  }),
  priority: z
    .strictObject({
      id: z.string().trim().min(1).max(128),
      name: z.string().trim().min(1).max(128),
    })
    .nullable(),
  comments: z
    .array(
      z.strictObject({
        commentId: z.string().trim().min(1).max(128),
        text: z.string().max(1_000_000),
        author: z.string().trim().min(1).max(10_000),
        createdAt: z.string().trim().min(1).max(32),
      }),
    )
    .readonly(),
  resourceLinks: z
    .array(
      z.strictObject({
        url: z.url().max(4_096),
        source: z.enum(['attachment', 'comment', 'description']),
      }),
    )
    .readonly(),
})

const StartRunResponseSchema = z.strictObject({
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  revisionId: RevisionIdSchema,
  profileSnapshotId: z.string().trim().min(1).max(256),
  taskReference: z.string().trim().min(1).max(512),
  notes: z.string().trim().min(1).max(2_000).nullable(),
  taskSnapshot: z.json(),
  effectiveConfiguration: z.json(),
  status: RunStatusSchema,
  currentNodeId: NodeIdSchema.nullable(),
  transitionCount: z.number().int().nonnegative().safe(),
  createdAt: z.iso.datetime({ offset: true }),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
})

const ProfileSnapshotRepositorySchema = ProfileRepositoryConfigurationSchema.extend({
  profilePosition: z.number().int().nonnegative().safe(),
})

const RunDetailResponseSchema = z.strictObject({
  run: StartRunResponseSchema,
  workflowRevision: WorkflowRevisionSchema,
  profileSnapshot: z.strictObject({
    snapshotId: z.string().trim().min(1).max(256),
    profileId: ProjectProfileConfigurationSchema.shape.profileId,
    displayName: ProjectProfileConfigurationSchema.shape.displayName,
    clickupWorkspaceId: ProjectProfileConfigurationSchema.shape.clickupWorkspaceId,
    clickupListId: ProjectProfileConfigurationSchema.shape.clickupListId,
    clickupInReviewStatusId: ProjectProfileConfigurationSchema.shape.clickupInReviewStatusId,
    createdAt: z.iso.datetime({ offset: true }),
    repositories: z.array(ProfileSnapshotRepositorySchema).min(1).max(32).readonly(),
  }),
  events: z.array(RunEventSchema).readonly(),
  nodeExecutions: z
    .array(
      z.strictObject({
        nodeExecutionId: z.string().trim().min(1).max(256),
        nodeId: NodeIdSchema,
        executionIndex: z.number().int().nonnegative().safe(),
        status: NodeExecutionStatusSchema,
        inputReferences: z.json(),
        output: z.json().nullable(),
        outcome: OutcomeNameSchema.nullable(),
        errorCode: z.string().trim().min(1).max(128).nullable(),
        errorMessage: z.string().trim().min(1).max(4_096).nullable(),
        selectedTargetNodeId: NodeIdSchema.nullable(),
        startedAt: z.iso.datetime({ offset: true }).nullable(),
        completedAt: z.iso.datetime({ offset: true }).nullable(),
        durationMs: z.number().int().nonnegative().finite().nullable(),
      }),
    )
    .readonly(),
  repositorySelection: z
    .strictObject({
      selected: z
        .array(
          z.strictObject({
            repositoryId: RepositoryIdSchema,
            rationale: z.string().trim().min(1),
            responsibility: z.string().trim().min(1),
          }),
        )
        .readonly(),
      excluded: z
        .array(
          z.strictObject({
            repositoryId: RepositoryIdSchema,
            rationale: z.string().trim().min(1),
          }),
        )
        .readonly(),
    })
    .nullable(),
  workspaces: z
    .array(
      z.strictObject({
        repositoryId: RepositoryIdSchema,
        profilePosition: z.number().int().nonnegative().safe(),
        repositoryPath: z.string().trim().min(1).max(4_096),
        worktreePath: z.string().trim().min(1).max(4_096),
        remote: z.string().trim().min(1).max(256),
        targetBranch: z.string().trim().min(1).max(512),
        sourceBranch: z.string().trim().min(1).max(512),
        baseSha: GitShaSchema,
        createdAt: z.iso.datetime({ offset: true }),
      }),
    )
    .readonly(),
  deliveryEvidence: z
    .array(
      z.strictObject({
        repositoryId: RepositoryIdSchema,
        profilePosition: z.number().int().nonnegative().safe(),
        status: z.enum(['PENDING', 'BRANCH_PUSHED', 'MERGE_REQUEST_CREATED', 'VERIFIED', 'FAILED']),
        gitlabProject: z.string().trim().min(1).max(512).nullable(),
        mergeRequestIid: z.number().int().positive().safe().nullable(),
        mergeRequestUrl: z.url().max(4_096).nullable(),
        sourceBranch: z.string().trim().min(1).max(512).nullable(),
        targetBranch: z.string().trim().min(1).max(512).nullable(),
        headSha: GitShaSchema.nullable(),
        evidence: z.json(),
        updatedAt: z.iso.datetime({ offset: true }),
      }),
    )
    .readonly(),
  outputChunks: z
    .array(
      z.strictObject({
        sequence: z.number().int().positive().safe(),
        eventSequence: z.number().int().positive().safe(),
        nodeExecutionId: z.string().trim().min(1).max(256),
        channel: z.enum(['stdout', 'stderr', 'agent']),
        repositoryId: RepositoryIdSchema.nullable(),
        content: z.string().max(65_536),
        createdAt: z.iso.datetime({ offset: true }),
      }),
    )
    .readonly(),
  artifacts: z
    .array(
      z.strictObject({
        artifactId: ArtifactIdSchema,
        nodeExecutionId: z.string().trim().min(1).max(256),
        artifactType: ArtifactTypeSchema,
        content: z.string(),
        metadata: z.json(),
        createdAt: z.iso.datetime({ offset: true }),
      }),
    )
    .readonly(),
})

export type WorkflowCatalogEntry = z.infer<typeof WorkflowCatalogEntrySchema>
export type ClickUpTaskSnapshot = z.infer<typeof ClickUpTaskSnapshotSchema>
export type StartRunResponse = z.infer<typeof StartRunResponseSchema>
export type RunDetailResponse = z.infer<typeof RunDetailResponseSchema>

export interface CreateWorkflowRevisionInput {
  readonly parentRevisionId: string
  readonly revisionId: string
  readonly updates: readonly {
    readonly nodeId: string
    readonly changes: AgentNodeConfigurationChanges
  }[]
}

export interface ResolveClickUpTaskInput {
  readonly taskReference: string
  readonly profileId: string
}

export interface StartRunInput extends ResolveClickUpTaskInput {
  readonly workflowId: string
  readonly revisionId: string
  readonly notes?: string
}

export interface ApiClient {
  getHealth(): Promise<HealthResponse>
  listProjectProfiles(): Promise<ProjectProfileCatalogResponse>
  createProjectProfile(profile: ProjectProfileConfiguration): Promise<ProjectProfileConfiguration>
  updateProjectProfile(profile: ProjectProfileConfiguration): Promise<ProjectProfileConfiguration>
  getProjectProfileReadiness(profileId: string): Promise<ProjectProfileReadiness>
  getConnectorStatus(): Promise<ConnectorStatus>
  listWorkflows(): Promise<readonly WorkflowCatalogEntry[]>
  getWorkflowRevision(workflowId: string, revisionId: string): Promise<WorkflowRevision>
  createWorkflowRevision(
    workflowId: string,
    input: CreateWorkflowRevisionInput,
  ): Promise<WorkflowRevision>
  resolveClickUpTask(input: ResolveClickUpTaskInput): Promise<ClickUpTaskSnapshot>
  startRun(input: StartRunInput): Promise<StartRunResponse>
  getRun(runId: string): Promise<RunDetailResponse>
  cancelRun(runId: string, input?: { readonly reason?: string }): Promise<StartRunResponse>
}

export class ApiClientError extends Error {
  override readonly name = 'ApiClientError'
  readonly code: string
  readonly status: number
  readonly details: unknown

  constructor(input: {
    readonly code: string
    readonly message: string
    readonly status: number
    readonly details?: unknown
  }) {
    super(input.message)
    this.code = input.code
    this.status = input.status
    this.details = input.details
  }
}

export const createApiClient = (
  options: Readonly<{ fetch?: typeof globalThis.fetch }> = {},
): ApiClient => {
  const fetchImplementation = options.fetch ?? globalThis.fetch

  const request = async <Schema extends z.ZodType>(
    path: string,
    init: RequestInit,
    schema: Schema,
  ): Promise<z.output<Schema>> => {
    const response = await fetchImplementation(path, init)
    const body: unknown = await response.json()

    if (!response.ok) {
      const apiError = ApiErrorSchema.parse(body).error
      throw new ApiClientError({
        code: apiError.code,
        message: apiError.message,
        status: response.status,
        ...(apiError.details === undefined ? {} : { details: apiError.details }),
      })
    }

    return schema.parse(body)
  }

  const get = <Schema extends z.ZodType>(path: string, schema: Schema) =>
    request(path, { headers: { accept: 'application/json' }, method: 'GET' }, schema)

  return {
    async getHealth() {
      return get('/api/healthz', HealthResponseSchema)
    },

    async listProjectProfiles() {
      return get('/api/project-profiles', ProjectProfileCatalogResponseSchema)
    },

    async createProjectProfile(profile) {
      return request(
        '/api/project-profiles',
        {
          body: JSON.stringify(profile),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'POST',
        },
        ProjectProfileConfigurationSchema,
      )
    },

    async updateProjectProfile(profile) {
      return request(
        `/api/project-profiles/${encodeURIComponent(profile.profileId)}`,
        {
          body: JSON.stringify(profile),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'PUT',
        },
        ProjectProfileConfigurationSchema,
      )
    },

    async getProjectProfileReadiness(profileId) {
      return get(
        `/api/project-profiles/${encodeURIComponent(profileId)}/readiness`,
        ProjectProfileReadinessSchema,
      )
    },

    async getConnectorStatus() {
      return get('/api/connectors/status', ConnectorStatusSchema)
    },

    async listWorkflows() {
      return (await get('/api/workflows', WorkflowCatalogResponseSchema)).workflows
    },

    async getWorkflowRevision(workflowId, revisionId) {
      return get(
        `/api/workflows/${encodeURIComponent(workflowId)}/revisions/${encodeURIComponent(revisionId)}`,
        WorkflowRevisionSchema,
      )
    },

    async createWorkflowRevision(workflowId, input) {
      return request(
        `/api/workflows/${encodeURIComponent(workflowId)}/revisions`,
        {
          body: JSON.stringify(input),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'POST',
        },
        WorkflowRevisionSchema,
      )
    },

    async resolveClickUpTask(input) {
      return request(
        '/api/clickup/tasks/resolve',
        {
          body: JSON.stringify(ResolveClickUpTaskRequestSchema.parse(input)),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'POST',
        },
        ClickUpTaskSnapshotSchema,
      )
    },

    async startRun(input) {
      return request(
        '/api/runs',
        {
          body: JSON.stringify(CreateRunRequestSchema.parse(input)),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'POST',
        },
        StartRunResponseSchema,
      )
    },

    async getRun(runId) {
      return get(
        `/api/runs/${encodeURIComponent(RunIdSchema.parse(runId))}`,
        RunDetailResponseSchema,
      )
    },

    async cancelRun(runId, input = {}) {
      return request(
        `/api/runs/${encodeURIComponent(RunIdSchema.parse(runId))}/cancel`,
        {
          body: JSON.stringify(CancelRunRequestSchema.parse(input)),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'POST',
        },
        StartRunResponseSchema,
      )
    },
  }
}
