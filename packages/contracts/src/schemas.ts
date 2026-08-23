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
export const RunIdSchema = opaqueId.brand<'RunId'>()
export const HarnessIdSchema = opaqueId.brand<'HarnessId'>()
export const NodeIdSchema = kebabCaseId.brand<'NodeId'>()
export const ProjectIdSchema = opaqueId.brand<'ProjectId'>()
export const DeletionIdSchema = opaqueId.brand<'DeletionId'>()
export const OutcomeNameSchema = kebabCaseId.brand<'OutcomeName'>()

export const RunStatusSchema = z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'])

export const NodeExecutionStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
])

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: errorCode,
    message,
    details: z.unknown().optional(),
  }),
})

export const HealthResponseSchema = z.strictObject({ status: z.literal('ok') })

export const GitShaSchema = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
  .brand<'GitSha'>()

export const HarnessThinkingLevelSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

export const HarnessModelOptionSchema = z.strictObject({
  id: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(128),
  thinkingLevels: z.array(HarnessThinkingLevelSchema).min(1).max(7).readonly(),
})

const harnessDescriptorBase = z.strictObject({
  harnessId: HarnessIdSchema,
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(512),
  installHref: z.url().max(4_096),
  installLabel: z.string().trim().min(1).max(128),
  models: z.array(HarnessModelOptionSchema).max(512).readonly(),
})

export const HarnessDescriptorSchema = z.discriminatedUnion('availability', [
  harnessDescriptorBase.extend({
    availability: z.literal('AVAILABLE'),
    executablePath: z.string().trim().min(1).max(4_096),
    version: z.string().trim().min(1).max(128),
  }),
  harnessDescriptorBase.extend({
    availability: z.literal('UNAVAILABLE'),
    unavailableReason: z.string().trim().min(1).max(512),
  }),
])

export const HarnessCatalogResponseSchema = z.strictObject({
  harnesses: z.array(HarnessDescriptorSchema).readonly(),
})

export const ProjectAvailabilitySchema = z.enum(['AVAILABLE', 'MISSING', 'NOT_GIT_REPOSITORY'])

export const ProjectSchema = z.strictObject({
  projectId: ProjectIdSchema,
  name: z.string().trim().min(1).max(256),
  repositoryPath: z.string().trim().min(1).max(4_096),
  availability: ProjectAvailabilitySchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const AddProjectRequestSchema = z.strictObject({
  repositoryPath: z.string().trim().min(1).max(4_096),
})

export const ProjectCatalogResponseSchema = z.strictObject({
  projects: z.array(ProjectSchema).readonly(),
})

export const DeletionSubjectSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('PROJECT'), id: ProjectIdSchema }),
])

export const DeletionReceiptSchema = z.strictObject({
  deletionId: DeletionIdSchema,
  subject: DeletionSubjectSchema,
  deletedAt: z.iso.datetime({ offset: true }),
  undoExpiresAt: z.iso.datetime({ offset: true }),
})

export const UndoDeletionResponseSchema = DeletionReceiptSchema.extend({
  state: z.literal('UNDONE'),
})

export const CreateRunRequestSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  variables: z.record(z.string().min(1).max(128), z.json()).optional(),
})

export const CancelRunRequestSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1_024).optional(),
})

export const RunPaginationQuerySchema = z
  .strictObject({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    runId: z.string().trim().min(1).max(128).optional(),
    statuses: z
      .array(RunStatusSchema)
      .max(RunStatusSchema.options.length)
      .refine((statuses) => new Set(statuses).size === statuses.length, {
        message: 'Statuses must be unique',
      })
      .optional(),
    startedFrom: z.iso.datetime({ offset: true }).optional(),
    startedTo: z.iso.datetime({ offset: true }).optional(),
    durationMinMs: z.coerce.number().int().nonnegative().safe().optional(),
    durationMaxMs: z.coerce.number().int().nonnegative().safe().optional(),
  })
  .superRefine((query, context) => {
    if (
      query.startedFrom !== undefined &&
      query.startedTo !== undefined &&
      Date.parse(query.startedFrom) > Date.parse(query.startedTo)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Started from must be before started to',
        path: ['startedFrom'],
      })
    }
    if (
      query.durationMinMs !== undefined &&
      query.durationMaxMs !== undefined &&
      query.durationMinMs > query.durationMaxMs
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Minimum duration must not exceed maximum duration',
        path: ['durationMinMs'],
      })
    }
  })

const runEventBase = z.strictObject({
  runId: RunIdSchema,
  sequence: z.number().int().positive().safe(),
  timestamp: z.iso.datetime({ offset: true }),
})

const nodeEventBase = runEventBase.extend({ nodeId: NodeIdSchema })

const RunStartedEventSchema = runEventBase.extend({
  type: z.literal('RUN_STARTED'),
  data: z.strictObject({ workflowId: WorkflowIdSchema }),
})

const RunStatusChangedEventSchema = runEventBase.extend({
  type: z.literal('RUN_STATUS_CHANGED'),
  data: z.strictObject({ from: RunStatusSchema, to: RunStatusSchema }),
})

const NodeStartedEventSchema = nodeEventBase.extend({
  type: z.literal('NODE_STARTED'),
  data: z.strictObject({}),
})

const NodeCompletedEventSchema = nodeEventBase.extend({
  type: z.literal('NODE_COMPLETED'),
  data: z.strictObject({
    outcome: OutcomeNameSchema,
    durationMs,
  }),
})

const NodeFailedEventSchema = nodeEventBase.extend({
  type: z.literal('NODE_FAILED'),
  data: z.strictObject({ code: errorCode, message, durationMs }),
})

const NodeCancelledEventSchema = nodeEventBase.extend({
  type: z.literal('NODE_CANCELLED'),
  data: z.strictObject({ reason: message, durationMs }),
})

const RunCancelRequestedEventSchema = runEventBase.extend({
  type: z.literal('RUN_CANCEL_REQUESTED'),
  data: z.strictObject({ reason: z.string().trim().min(1).max(1_024) }),
})

const RunCompletedEventSchema = runEventBase.extend({
  type: z.literal('RUN_COMPLETED'),
  data: z.strictObject({
    status: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED']),
    durationMs,
  }),
})

export const RunEventSchema = z.discriminatedUnion('type', [
  RunStartedEventSchema,
  RunStatusChangedEventSchema,
  NodeStartedEventSchema,
  NodeCompletedEventSchema,
  NodeFailedEventSchema,
  NodeCancelledEventSchema,
  RunCancelRequestedEventSchema,
  RunCompletedEventSchema,
])

export const AgentTraceEventTypeSchema = z.enum([
  'AGENT_STARTED',
  'AGENT_SESSION_IDENTIFIED',
  'AGENT_MESSAGE',
  'AGENT_REASONING',
  'HARNESS_EVENT',
  'AGENT_TOOL_STARTED',
  'AGENT_TOOL_UPDATED',
  'AGENT_TOOL_COMPLETED',
  'AGENT_RESULT',
  'AGENT_FAILED',
  'AGENT_CANCELLED',
])

export const AgentTraceHeaderSchema = z.strictObject({
  version: z.literal(1),
  runId: RunIdSchema,
  nodeExecutionId: opaqueId,
  attemptId: opaqueId,
  nodeId: NodeIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  configuration: z.strictObject({
    harnessId: HarnessIdSchema,
    harnessVersion: z.string().trim().min(1).max(128),
    model: z.string().trim().min(1).max(256).optional(),
    thinkingLevel: HarnessThinkingLevelSchema.optional(),
    renderedPrompt: z.string().min(1).max(1_000_000),
    workspaceRoot: z.string().trim().min(1).max(4_096),
    primaryProjectId: ProjectIdSchema,
    projects: z
      .array(
        z.strictObject({
          projectId: ProjectIdSchema,
          name: z.string().trim().min(1).max(256),
          worktreePath: z.string().trim().min(1).max(4_096),
          baseSha: GitShaSchema,
          sourceBranch: z.string().trim().min(1).max(512).nullable(),
        }),
      )
      .min(1)
      .max(32)
      .readonly(),
    timeoutSeconds: z.number().int().positive().safe(),
  }),
})

export const AgentTraceEventSchema = z.strictObject({
  sequence: z.number().int().positive().safe(),
  timestamp: z.iso.datetime({ offset: true }),
  type: AgentTraceEventTypeSchema,
  data: z.json(),
})

export const AgentTraceSchema = z.strictObject({
  header: AgentTraceHeaderSchema,
  events: z.array(AgentTraceEventSchema).readonly(),
  complete: z.boolean(),
})

export type WorkflowId = z.infer<typeof WorkflowIdSchema>
export type RunId = z.infer<typeof RunIdSchema>
export type HarnessId = z.infer<typeof HarnessIdSchema>
export type NodeId = z.infer<typeof NodeIdSchema>
export type ProjectId = z.infer<typeof ProjectIdSchema>
export type OutcomeName = z.infer<typeof OutcomeNameSchema>
export type RunStatus = z.infer<typeof RunStatusSchema>
export type NodeExecutionStatus = z.infer<typeof NodeExecutionStatusSchema>
export type ApiError = z.infer<typeof ApiErrorSchema>
export type HealthResponse = z.infer<typeof HealthResponseSchema>
export type GitSha = z.infer<typeof GitShaSchema>
export type HarnessThinkingLevel = z.infer<typeof HarnessThinkingLevelSchema>
export type HarnessModelOption = z.infer<typeof HarnessModelOptionSchema>
export type HarnessDescriptor = z.infer<typeof HarnessDescriptorSchema>
export type HarnessCatalogResponse = z.infer<typeof HarnessCatalogResponseSchema>
export type ProjectAvailability = z.infer<typeof ProjectAvailabilitySchema>
export type Project = z.infer<typeof ProjectSchema>
export type DeletionReceipt = z.infer<typeof DeletionReceiptSchema>
export type UndoDeletionResponse = z.infer<typeof UndoDeletionResponseSchema>
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>
export type CancelRunRequest = z.infer<typeof CancelRunRequestSchema>
export type RunPaginationQuery = z.infer<typeof RunPaginationQuerySchema>
export type RunEvent = z.infer<typeof RunEventSchema>
export type AgentTraceEventType = z.infer<typeof AgentTraceEventTypeSchema>
export type AgentTraceHeader = z.infer<typeof AgentTraceHeaderSchema>
export type AgentTraceEvent = z.infer<typeof AgentTraceEventSchema>
export type AgentTrace = z.infer<typeof AgentTraceSchema>
