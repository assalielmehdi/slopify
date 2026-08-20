import { z } from 'zod'

const OPAQUE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const KEBAB_CASE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/

const opaqueId = z.string().min(1).max(128).regex(OPAQUE_ID_PATTERN)
const kebabCaseId = z.string().min(1).max(128).regex(KEBAB_CASE_PATTERN)
const errorCode = z.string().min(1).max(128).regex(ERROR_CODE_PATTERN)
const message = z.string().trim().min(1).max(4_096)
const durationMs = z.number().int().nonnegative().finite()
const mergeRequestProject = z
  .string()
  .trim()
  .min(3)
  .max(512)
  .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)+$/iu)
const mergeRequestBranch = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[^\s?&#]+$/u)
const httpsUrl = z
  .url()
  .max(4_096)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  })

export const WorkflowIdSchema = opaqueId.brand<'WorkflowId'>()
export const RevisionIdSchema = opaqueId.brand<'RevisionId'>()
export const RunIdSchema = opaqueId.brand<'RunId'>()
export const NodeIdSchema = kebabCaseId.brand<'NodeId'>()
export const ArtifactIdSchema = opaqueId.brand<'ArtifactId'>()
export const ProjectProfileIdSchema = opaqueId.brand<'ProjectProfileId'>()
export const RepositoryIdSchema = opaqueId.brand<'RepositoryId'>()
export const OutcomeNameSchema = kebabCaseId.brand<'OutcomeName'>()

export const RunStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
])

export const NodeExecutionStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
])

export const ArtifactTypeSchema = z.enum([
  'EXECUTION_PLAN',
  'IMPLEMENTATION_SUMMARY',
  'REVIEW_SUMMARY',
  'FINALIZATION',
])

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: errorCode,
    message,
    details: z.unknown().optional(),
  }),
})

export const HealthResponseSchema = z.strictObject({
  status: z.literal('ok'),
})

export const EvidenceSchema = z.strictObject({
  kind: z.enum(['command', 'test', 'file', 'url', 'note']),
  value: z.string().trim().min(1).max(16_384),
  repositoryId: RepositoryIdSchema.optional(),
})

export const RepositoryReferenceSchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  path: z.string().min(1).max(4_096),
  access: z.enum(['read-only', 'workspace-write']),
})

export const GitShaSchema = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
  .brand<'GitSha'>()

export const GitWorkspaceSchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  repositoryPath: z.string().trim().min(1).max(4_096),
  worktreePath: z.string().trim().min(1).max(4_096),
  remote: z.string().trim().min(1).max(256),
  targetBranch: z.string().trim().min(1).max(512),
  sourceBranch: z.string().trim().min(1).max(512),
  baseSha: GitShaSchema,
})

export const MergeRequestEvidenceSchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  project: mergeRequestProject,
  iid: z.number().int().positive().safe(),
  url: httpsUrl,
  state: z.literal('opened'),
  sourceBranch: mergeRequestBranch,
  targetBranch: mergeRequestBranch,
  baseSha: GitShaSchema,
  headSha: GitShaSchema,
})

export const FinalizeGitLabInputSchema = z
  .strictObject({
    runId: RunIdSchema,
    taskId: z.string().trim().min(1).max(512),
    workspaces: z.array(GitWorkspaceSchema).min(1).max(32).readonly(),
  })
  .refine(
    ({ workspaces }) =>
      new Set(workspaces.map(({ repositoryId }) => repositoryId)).size === workspaces.length,
    { message: 'Workspace repository IDs must be unique', path: ['workspaces'] },
  )

export const FinalizeClickUpInputSchema = z
  .strictObject({
    runId: RunIdSchema,
    taskId: z.string().trim().min(1).max(128),
    mergeRequests: z.array(MergeRequestEvidenceSchema).min(1).max(32).readonly(),
  })
  .refine(
    ({ mergeRequests }) =>
      new Set(mergeRequests.map(({ repositoryId }) => repositoryId)).size === mergeRequests.length,
    { message: 'Merge request repository IDs must be unique', path: ['mergeRequests'] },
  )

export const PrepareGitWorkspacesInputSchema = z
  .strictObject({
    runId: RunIdSchema,
    taskId: z.string().trim().min(1).max(512),
    profileId: ProjectProfileIdSchema,
    selectedRepositoryIds: z.array(RepositoryIdSchema).min(1).max(32).readonly(),
  })
  .refine(
    ({ selectedRepositoryIds }) =>
      new Set(selectedRepositoryIds).size === selectedRepositoryIds.length,
    { message: 'Selected repository IDs must be unique', path: ['selectedRepositoryIds'] },
  )

const configuredCommand = z.strictObject({
  executable: z.string().trim().min(1).max(1_024),
  arguments: z.array(z.string().max(4_096)).max(64).readonly(),
})

export const ExecutableCheckConfigurationSchema = configuredCommand.extend({
  expectedOutputIncludes: z.string().min(1).max(512).optional(),
})

export const VerificationCommandConfigurationSchema = configuredCommand

export const ProfileRepositoryConfigurationSchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  displayName: z.string().trim().min(1).max(256),
  purpose: z.string().trim().min(1).max(2_048),
  repositoryPath: z.string().trim().min(1).max(4_096),
  gitlabProject: z.string().trim().min(1).max(512),
  remote: z.string().trim().min(1).max(256),
  targetBranch: z.string().trim().min(1).max(512),
  worktreeParent: z.string().trim().min(1).max(4_096),
  branchTemplate: z.string().trim().min(1).max(512),
  executableChecks: z.array(ExecutableCheckConfigurationSchema).max(16).readonly(),
  verificationCommands: z.array(VerificationCommandConfigurationSchema).max(32).readonly(),
  mergeRequestLabels: z.array(z.string().trim().min(1).max(256)).max(32).readonly(),
})

export const ProjectProfileConfigurationSchema = z.strictObject({
  profileId: ProjectProfileIdSchema,
  displayName: z.string().trim().min(1).max(256),
  clickupWorkspaceId: z.string().trim().min(1).max(256),
  clickupListId: z.string().trim().min(1).max(256),
  clickupInReviewStatusId: z.string().trim().min(1).max(256),
  repositories: z.array(ProfileRepositoryConfigurationSchema).max(32).readonly(),
})

export const ProjectProfileRuntimeBoundarySchema = z.strictObject({
  mode: z.enum(['native', 'container']),
  root: z.string().trim().min(1).max(4_096),
})

export const ProjectProfileCatalogResponseSchema = z.strictObject({
  profiles: z.array(ProjectProfileConfigurationSchema).readonly(),
  runtime: ProjectProfileRuntimeBoundarySchema,
})

export const ConnectorStatusSchema = z.strictObject({
  clickup: z.boolean(),
  gitlab: z.boolean(),
  modelProvider: z.boolean(),
})

const ReadinessFindingSchema = z.strictObject({
  category: z.enum(['filesystem', 'git', 'tool', 'clickup', 'gitlab', 'model-provider']),
  code: errorCode,
  message,
})

export const ProjectProfileReadinessSchema = z.strictObject({
  profileId: ProjectProfileIdSchema,
  ready: z.boolean(),
  repositories: z.array(
    z.strictObject({
      repositoryId: RepositoryIdSchema,
      ready: z.boolean(),
      findings: z.array(ReadinessFindingSchema).readonly(),
    }),
  ),
})

export const CreateRunRequestSchema = z.strictObject({
  taskReference: z.string().trim().min(1).max(512),
  workflowId: WorkflowIdSchema,
  revisionId: RevisionIdSchema,
  profileId: ProjectProfileIdSchema,
  notes: z.string().trim().min(1).max(2_000).optional(),
})

export const ResolveClickUpTaskRequestSchema = z.strictObject({
  taskReference: z.string().trim().min(1).max(512),
  profileId: ProjectProfileIdSchema,
})

export const CancelRunRequestSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1_024).optional(),
})

export const RunPaginationQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const runEventBase = z.strictObject({
  runId: RunIdSchema,
  sequence: z.number().int().positive().safe(),
  timestamp: z.iso.datetime({ offset: true }),
})

const nodeEventBase = runEventBase.extend({
  nodeId: NodeIdSchema,
})

const RunStartedEventSchema = runEventBase.extend({
  type: z.literal('RUN_STARTED'),
  data: z.strictObject({
    workflowId: WorkflowIdSchema,
    revisionId: RevisionIdSchema,
    profileId: ProjectProfileIdSchema,
    taskReference: z.string().trim().min(1).max(512),
  }),
})

const RunStatusChangedEventSchema = runEventBase.extend({
  type: z.literal('RUN_STATUS_CHANGED'),
  data: z.strictObject({
    from: RunStatusSchema,
    to: RunStatusSchema,
  }),
})

const NodeStartedEventSchema = nodeEventBase.extend({
  type: z.literal('NODE_STARTED'),
  data: z.strictObject({}),
})

const NodeOutputEventSchema = nodeEventBase.extend({
  type: z.literal('NODE_OUTPUT'),
  data: z.strictObject({
    channel: z.enum(['stdout', 'stderr', 'agent']),
    content: z.string().max(65_536),
    repositoryId: RepositoryIdSchema.optional(),
  }),
})

const NodeCompletedEventSchema = nodeEventBase.extend({
  type: z.literal('NODE_COMPLETED'),
  data: z.strictObject({
    outcome: OutcomeNameSchema.optional(),
    durationMs,
    artifactIds: z.array(ArtifactIdSchema).max(32),
  }),
})

const NodeFailedEventSchema = nodeEventBase.extend({
  type: z.literal('NODE_FAILED'),
  data: z.strictObject({
    code: errorCode,
    message,
    durationMs,
  }),
})

const EdgeSelectedEventSchema = nodeEventBase.extend({
  type: z.literal('EDGE_SELECTED'),
  data: z.strictObject({
    outcome: OutcomeNameSchema,
    targetNodeId: NodeIdSchema,
  }),
})

const ArtifactRecordedEventSchema = nodeEventBase.extend({
  type: z.literal('ARTIFACT_RECORDED'),
  data: z.strictObject({
    artifactId: ArtifactIdSchema,
    artifactType: ArtifactTypeSchema,
    operation: z.enum(['created', 'updated']).optional(),
  }),
})

const RunCancelRequestedEventSchema = runEventBase.extend({
  type: z.literal('RUN_CANCEL_REQUESTED'),
  data: z.strictObject({
    reason: z.string().trim().min(1).max(1_024).optional(),
  }),
})

const RunCompletedEventSchema = runEventBase.extend({
  type: z.literal('RUN_COMPLETED'),
  data: z.strictObject({
    status: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']),
    durationMs,
  }),
})

export const RunEventSchema = z.discriminatedUnion('type', [
  RunStartedEventSchema,
  RunStatusChangedEventSchema,
  NodeStartedEventSchema,
  NodeOutputEventSchema,
  NodeCompletedEventSchema,
  NodeFailedEventSchema,
  EdgeSelectedEventSchema,
  ArtifactRecordedEventSchema,
  RunCancelRequestedEventSchema,
  RunCompletedEventSchema,
])

export type WorkflowId = z.infer<typeof WorkflowIdSchema>
export type RevisionId = z.infer<typeof RevisionIdSchema>
export type RunId = z.infer<typeof RunIdSchema>
export type NodeId = z.infer<typeof NodeIdSchema>
export type ArtifactId = z.infer<typeof ArtifactIdSchema>
export type ProjectProfileId = z.infer<typeof ProjectProfileIdSchema>
export type RepositoryId = z.infer<typeof RepositoryIdSchema>
export type OutcomeName = z.infer<typeof OutcomeNameSchema>
export type RunStatus = z.infer<typeof RunStatusSchema>
export type NodeExecutionStatus = z.infer<typeof NodeExecutionStatusSchema>
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>
export type ApiError = z.infer<typeof ApiErrorSchema>
export type HealthResponse = z.infer<typeof HealthResponseSchema>
export type Evidence = z.infer<typeof EvidenceSchema>
export type RepositoryReference = z.infer<typeof RepositoryReferenceSchema>
export type GitSha = z.infer<typeof GitShaSchema>
export type GitWorkspace = z.infer<typeof GitWorkspaceSchema>
export type MergeRequestEvidence = z.infer<typeof MergeRequestEvidenceSchema>
export type FinalizeGitLabInput = z.infer<typeof FinalizeGitLabInputSchema>
export type FinalizeClickUpInput = z.infer<typeof FinalizeClickUpInputSchema>
export type PrepareGitWorkspacesInput = z.infer<typeof PrepareGitWorkspacesInputSchema>
export type ExecutableCheckConfiguration = z.infer<typeof ExecutableCheckConfigurationSchema>
export type VerificationCommandConfiguration = z.infer<
  typeof VerificationCommandConfigurationSchema
>
export type ProfileRepositoryConfiguration = z.infer<typeof ProfileRepositoryConfigurationSchema>
export type ProjectProfileConfiguration = z.infer<typeof ProjectProfileConfigurationSchema>
export type ProjectProfileRuntimeBoundary = z.infer<typeof ProjectProfileRuntimeBoundarySchema>
export type ProjectProfileCatalogResponse = z.infer<typeof ProjectProfileCatalogResponseSchema>
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>
export type ProjectProfileReadiness = z.infer<typeof ProjectProfileReadinessSchema>
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>
export type ResolveClickUpTaskRequest = z.infer<typeof ResolveClickUpTaskRequestSchema>
export type CancelRunRequest = z.infer<typeof CancelRunRequestSchema>
export type RunPaginationQuery = z.infer<typeof RunPaginationQuerySchema>
export type RunEvent = z.infer<typeof RunEventSchema>
