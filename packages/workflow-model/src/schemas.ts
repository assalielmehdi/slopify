import { NodeIdSchema, OutcomeNameSchema, WorkflowIdSchema } from '@slopify/contracts'
import { z } from 'zod'

const RESOURCE_BUNDLE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

const nonBlankString = z.string().trim().min(1)
const promptTemplate = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: 'Prompt template must not be blank',
  })
const outcomes = z.array(OutcomeNameSchema).min(1).readonly()
const timeoutSeconds = z.number().int().positive().safe()

export const DEFAULT_AGENT_TIMEOUT_SECONDS = 300
export const DEFAULT_AGENT_DESCRIPTION = 'Workflow agent'

export const ResourceBundleIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(RESOURCE_BUNDLE_ID_PATTERN)
  .brand<'ResourceBundleId'>()
const ConfigurationIdSchema = z.string().min(1).max(128).regex(RESOURCE_BUNDLE_ID_PATTERN)

export const WorkspacePolicySchema = z.enum(['candidate-repositories', 'selected-worktrees'])
export const PermissionProfileSchema = z.enum(['read-only', 'workspace-write'])
export const TerminalStatusSchema = z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED'])

export const SkillSnapshotReferenceSchema = z
  .strictObject({
    skillId: ResourceBundleIdSchema,
    snapshotId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    digest: z.string().regex(SHA256_PATTERN),
    name: nonBlankString.max(128),
    description: nonBlankString.max(2_048),
  })
  .readonly()

export const AgentInferenceConfigurationSchema = z
  .strictObject({
    connectionId: ConfigurationIdSchema.default('openrouter-default'),
    modelId: nonBlankString.max(256).default('openai/gpt-5.4'),
    thinkingLevel: z
      .enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
      .default('medium'),
  })
  .readonly()

export const AgentJobDefinitionSchema = z
  .strictObject({
    kind: z.literal('agent'),
    prompt: promptTemplate,
    skillSnapshotRefs: z.array(SkillSnapshotReferenceSchema).max(32).readonly().default([]),
    inference: AgentInferenceConfigurationSchema.default({
      connectionId: 'openrouter-default',
      modelId: 'openai/gpt-5.4',
      thinkingLevel: 'medium',
    }),
    connectorIds: z.array(ResourceBundleIdSchema).max(32).readonly().default([]),
  })
  .superRefine((job, context) => {
    const skillIds = job.skillSnapshotRefs.map(({ skillId }) => skillId)
    const snapshotIds = job.skillSnapshotRefs.map(({ snapshotId }) => snapshotId)
    if (new Set(skillIds).size !== skillIds.length)
      context.addIssue({
        code: 'custom',
        path: ['skillSnapshotRefs'],
        message: 'Skills must be unique',
      })
    if (new Set(snapshotIds).size !== snapshotIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['skillSnapshotRefs'],
        message: 'Skill snapshots must be unique',
      })
    }
    if (new Set(job.connectorIds).size !== job.connectorIds.length)
      context.addIssue({
        code: 'custom',
        path: ['connectorIds'],
        message: 'Connectors must be unique',
      })
  })
  .readonly()

export const JobDefinitionSchema = z.discriminatedUnion('kind', [AgentJobDefinitionSchema])

export const ResultContractSchema = z
  .strictObject({ schemaRef: nonBlankString.max(512) })
  .readonly()

export const SandboxReferenceSchema = z
  .strictObject({
    profileId: ConfigurationIdSchema.default('agent-default-v1'),
    imageId: ConfigurationIdSchema.default('gondolin-alpine-v1'),
  })
  .readonly()

export const AgentNodeSchema = z
  .strictObject({
    type: z.literal('agent'),
    id: NodeIdSchema,
    name: nonBlankString,
    description: nonBlankString.default(DEFAULT_AGENT_DESCRIPTION),
    timeoutSeconds: timeoutSeconds.default(DEFAULT_AGENT_TIMEOUT_SECONDS),
    result: ResultContractSchema.default({ schemaRef: 'json:any-v1' }),
    sandbox: SandboxReferenceSchema.default({
      profileId: 'agent-default-v1',
      imageId: 'gondolin-alpine-v1',
    }),
    job: AgentJobDefinitionSchema,
  })
  .readonly()

export const CommandNodeSchema = z
  .strictObject({
    type: z.literal('command'),
    id: NodeIdSchema,
    name: nonBlankString,
    description: nonBlankString,
    commandId: nonBlankString,
    outcomes,
    timeoutSeconds,
  })
  .readonly()

export const RouterNodeSchema = z
  .strictObject({
    type: z.literal('router'),
    id: NodeIdSchema,
    name: nonBlankString,
    description: nonBlankString,
    inputField: nonBlankString,
    outcomes,
  })
  .readonly()

export const TerminalNodeSchema = z
  .strictObject({
    type: z.literal('terminal'),
    id: NodeIdSchema,
    name: nonBlankString,
    terminalStatus: TerminalStatusSchema,
  })
  .readonly()

export const WorkflowNodeSchema = z.discriminatedUnion('type', [
  AgentNodeSchema,
  CommandNodeSchema,
  RouterNodeSchema,
  TerminalNodeSchema,
])

export const WorkflowEdgeSchema = z
  .strictObject({
    sourceNodeId: NodeIdSchema,
    outcome: OutcomeNameSchema,
    targetNodeId: NodeIdSchema,
    label: nonBlankString,
  })
  .readonly()

export const WorkflowSchema = z
  .strictObject({
    workflowId: WorkflowIdSchema,
    name: nonBlankString,
    description: nonBlankString,
    startNodeId: NodeIdSchema.nullable(),
    nodes: z.array(WorkflowNodeSchema).readonly(),
    edges: z.array(WorkflowEdgeSchema).readonly(),
    maxTransitions: z.number().int().nonnegative().safe(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .readonly()
