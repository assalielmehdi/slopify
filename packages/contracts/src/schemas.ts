import { z } from 'zod'

const OPAQUE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const KEBAB_CASE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/

const opaqueId = z.string().min(1).max(128).regex(OPAQUE_ID_PATTERN)
const kebabCaseId = z.string().min(1).max(128).regex(KEBAB_CASE_PATTERN)
const errorCode = z.string().min(1).max(128).regex(ERROR_CODE_PATTERN)
const message = z.string().trim().min(1).max(4_096)
const durationMs = z.number().int().nonnegative().finite()

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
export type RunEvent = z.infer<typeof RunEventSchema>
