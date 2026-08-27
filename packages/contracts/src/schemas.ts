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
export const RepositoryIdSchema = opaqueId.brand<'RepositoryId'>()
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

export const GitProviderSchema = z.enum(['GITHUB', 'GITLAB'])

export const GitConnectionSchema = z.strictObject({
  provider: GitProviderSchema,
  accountUsername: z.string().trim().min(1).max(256),
  connectedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const GitConnectionCatalogResponseSchema = z.strictObject({
  connections: z.array(GitConnectionSchema).max(GitProviderSchema.options.length).readonly(),
})

export const ThemePreferenceSchema = z.enum(['light', 'dark', 'system'])

const SettingsGitConnectionsSchema = z
  .array(GitConnectionSchema)
  .max(GitProviderSchema.options.length)
  .superRefine((connections, context) => {
    const providers = new Set<GitProvider>()
    for (const [index, connection] of connections.entries()) {
      if (providers.has(connection.provider)) {
        context.addIssue({
          code: 'custom',
          message: 'Git connection providers must be unique',
          path: [index, 'provider'],
        })
      }
      providers.add(connection.provider)
    }
  })
  .readonly()

export const SettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  appearance: z.strictObject({ theme: ThemePreferenceSchema }),
  git: z.strictObject({ connections: SettingsGitConnectionsSchema }),
})

export const UpdateSettingsRequestSchema = z.strictObject({
  appearance: z.strictObject({ theme: ThemePreferenceSchema }),
})

export const ConfigureGitConnectionRequestSchema = z.strictObject({
  token: z.string().trim().min(1).max(16_384),
})

export const GitRepositoryVisibilitySchema = z.enum(['PUBLIC', 'INTERNAL', 'PRIVATE'])

export const GitRepositorySchema = z.strictObject({
  provider: GitProviderSchema,
  remoteId: z.string().regex(/^\d+$/u).max(128),
  name: z.string().trim().min(1).max(256),
  fullName: z.string().trim().min(1).max(512),
  cloneUrl: z.url({ protocol: /^https$/u }).max(4_096),
  webUrl: z.url({ protocol: /^https$/u }).max(4_096),
  visibility: GitRepositoryVisibilitySchema,
  defaultBranch: z.string().trim().min(1).max(512),
})

export const GitRepositoryCatalogResponseSchema = z.strictObject({
  repositories: z.array(GitRepositorySchema).max(100_000).readonly(),
})

export const HarnessThinkingLevelSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
])

export const HarnessModelOptionSchema = z.strictObject({
  id: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(128),
  thinkingLevels: z.array(HarnessThinkingLevelSchema).min(1).max(8).readonly(),
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

export const RepositoryAvailabilitySchema = z.enum([
  'AVAILABLE',
  'CONNECTION_MISSING',
  'REPOSITORY_UNAVAILABLE',
])

export const RepositorySchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  name: z.string().trim().min(1).max(256),
  provider: GitProviderSchema,
  remoteId: z.string().regex(/^\d+$/u).max(128),
  fullName: z.string().trim().min(1).max(512),
  cloneUrl: z.url({ protocol: /^https$/u }).max(4_096),
  webUrl: z.url({ protocol: /^https$/u }).max(4_096),
  defaultBranch: z.string().trim().min(1).max(512),
  availability: RepositoryAvailabilitySchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const AddRepositoryRequestSchema = z.strictObject({
  provider: GitProviderSchema,
  remoteId: z.string().regex(/^\d+$/u).max(128),
})

export const RepositoryCatalogResponseSchema = z.strictObject({
  repositories: z.array(RepositorySchema).readonly(),
})

export const ResourceChangeTypeSchema = z.enum(['CREATED', 'CHANGED', 'DELETED'])

export const EditableResourceSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('SETTINGS') }),
  z.strictObject({ type: z.literal('REPOSITORIES') }),
  z.strictObject({ type: z.literal('WORKFLOW'), workflowId: WorkflowIdSchema }),
])

export const ResourceChangeEventSchema = z.strictObject({
  sequence: z.number().int().positive().safe(),
  timestamp: z.iso.datetime({ offset: true }),
  change: ResourceChangeTypeSchema,
  resource: EditableResourceSchema,
  revision: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .nullable(),
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
  'AGENT_SKILL_INVOKED',
  'AGENT_RESULT',
  'AGENT_FAILED',
  'AGENT_CANCELLED',
])

const agentTraceHeaderFields = {
  runId: RunIdSchema,
  nodeExecutionId: opaqueId,
  attemptId: opaqueId,
  nodeId: NodeIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
} as const

const agentTraceConfigurationFields = {
  harnessId: HarnessIdSchema,
  harnessVersion: z.string().trim().min(1).max(128),
  model: z.string().trim().min(1).max(256).optional(),
  thinkingLevel: HarnessThinkingLevelSchema.optional(),
  renderedPrompt: z.string().min(1).max(1_000_000),
  workspaceRoot: z.string().trim().min(1).max(4_096),
  primaryRepositoryId: RepositoryIdSchema,
  timeoutSeconds: z.number().int().positive().safe(),
} as const

const LegacyAgentTraceHeaderSchema = z.strictObject({
  version: z.literal(1),
  ...agentTraceHeaderFields,
  configuration: z.strictObject({
    ...agentTraceConfigurationFields,
    repositories: z
      .array(
        z.strictObject({
          repositoryId: RepositoryIdSchema,
          name: z.string().trim().min(1).max(256),
          worktreePath: z.string().trim().min(1).max(4_096),
          baseSha: GitShaSchema,
          sourceBranch: z.string().trim().min(1).max(512).nullable(),
        }),
      )
      .min(1)
      .max(32)
      .readonly(),
  }),
})

const ClonedWorkspaceAgentTraceHeaderSchema = z.strictObject({
  version: z.literal(2),
  ...agentTraceHeaderFields,
  configuration: z.strictObject({
    ...agentTraceConfigurationFields,
    repositories: z
      .array(
        z.strictObject({
          repositoryId: RepositoryIdSchema,
          name: z.string().trim().min(1).max(256),
          provider: GitProviderSchema,
          fullName: z.string().trim().min(1).max(512),
          workspacePath: z.string().trim().min(1).max(4_096),
          branchName: z.string().trim().min(1).max(512),
          baseSha: GitShaSchema,
          defaultBranch: z.string().trim().min(1).max(512),
        }),
      )
      .min(1)
      .max(32)
      .readonly(),
  }),
})

const RepositoryWorkspaceAgentTraceHeaderSchema = ClonedWorkspaceAgentTraceHeaderSchema.extend({
  version: z.literal(3),
})

const normalizeLegacyAgentTraceHeader = (input: unknown): unknown => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input
  const header = input as Record<string, unknown>
  const configuration = header.configuration
  if (typeof configuration !== 'object' || configuration === null || Array.isArray(configuration)) {
    return input
  }
  const legacy = configuration as Record<string, unknown>
  if (!Array.isArray(legacy.projects)) return input
  const { primaryProjectId, projects, ...currentConfiguration } = legacy
  return {
    ...header,
    configuration: {
      ...currentConfiguration,
      primaryRepositoryId: primaryProjectId,
      repositories: projects.map((entry) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry
        const { projectId, ...repository } = entry as Record<string, unknown>
        return { ...repository, repositoryId: projectId }
      }),
    },
  }
}

export const AgentTraceHeaderSchema = z.preprocess(
  normalizeLegacyAgentTraceHeader,
  z.discriminatedUnion('version', [
    LegacyAgentTraceHeaderSchema,
    ClonedWorkspaceAgentTraceHeaderSchema,
    RepositoryWorkspaceAgentTraceHeaderSchema,
  ]),
)

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
export type RepositoryId = z.infer<typeof RepositoryIdSchema>
export type OutcomeName = z.infer<typeof OutcomeNameSchema>
export type RunStatus = z.infer<typeof RunStatusSchema>
export type NodeExecutionStatus = z.infer<typeof NodeExecutionStatusSchema>
export type ApiError = z.infer<typeof ApiErrorSchema>
export type HealthResponse = z.infer<typeof HealthResponseSchema>
export type GitSha = z.infer<typeof GitShaSchema>
export type GitProvider = z.infer<typeof GitProviderSchema>
export type GitConnection = z.infer<typeof GitConnectionSchema>
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>
export type Settings = z.infer<typeof SettingsSchema>
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>
export type GitRepositoryVisibility = z.infer<typeof GitRepositoryVisibilitySchema>
export type GitRepository = z.infer<typeof GitRepositorySchema>
export type HarnessThinkingLevel = z.infer<typeof HarnessThinkingLevelSchema>
export type HarnessModelOption = z.infer<typeof HarnessModelOptionSchema>
export type HarnessDescriptor = z.infer<typeof HarnessDescriptorSchema>
export type HarnessCatalogResponse = z.infer<typeof HarnessCatalogResponseSchema>
export type RepositoryAvailability = z.infer<typeof RepositoryAvailabilitySchema>
export type Repository = z.infer<typeof RepositorySchema>
export type ResourceChangeType = z.infer<typeof ResourceChangeTypeSchema>
export type EditableResource = z.infer<typeof EditableResourceSchema>
export type ResourceChangeEvent = z.infer<typeof ResourceChangeEventSchema>
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>
export type CancelRunRequest = z.infer<typeof CancelRunRequestSchema>
export type RunPaginationQuery = z.infer<typeof RunPaginationQuerySchema>
export type RunEvent = z.infer<typeof RunEventSchema>
export type AgentTraceEventType = z.infer<typeof AgentTraceEventTypeSchema>
export type AgentTraceHeader = z.infer<typeof AgentTraceHeaderSchema>
export type AgentTraceEvent = z.infer<typeof AgentTraceEventSchema>
export type AgentTrace = z.infer<typeof AgentTraceSchema>
