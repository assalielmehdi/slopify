import {
  ArtifactTypeSchema,
  NodeIdSchema,
  OutcomeNameSchema,
  RevisionIdSchema,
  WorkflowIdSchema,
} from '@loop/contracts'
import { z } from 'zod'

const RESOURCE_BUNDLE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

const nonBlankString = z.string().trim().min(1)
const promptTemplate = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: 'Prompt template must not be blank',
  })
const outcomes = z.array(OutcomeNameSchema).min(1).readonly()
const timeoutSeconds = z.number().int().positive().safe()

export const ResourceBundleIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(RESOURCE_BUNDLE_ID_PATTERN)
  .brand<'ResourceBundleId'>()

export const WorkspacePolicySchema = z.enum(['candidate-repositories', 'selected-worktrees'])
export const PermissionProfileSchema = z.enum(['read-only', 'workspace-write'])
export const TerminalStatusSchema = z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED'])

export const AgentNodeSchema = z
  .strictObject({
    type: z.literal('agent'),
    id: NodeIdSchema,
    name: nonBlankString,
    description: nonBlankString,
    provider: nonBlankString,
    model: nonBlankString,
    thinkingLevel: nonBlankString,
    promptTemplate,
    workspacePolicy: WorkspacePolicySchema,
    permissionProfile: PermissionProfileSchema,
    resourceBundleId: ResourceBundleIdSchema,
    inputArtifacts: z.array(ArtifactTypeSchema).readonly(),
    outputSchemaRef: nonBlankString,
    outcomes,
    timeoutSeconds,
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

export const WorkflowRevisionSchema = z
  .strictObject({
    workflowId: WorkflowIdSchema,
    revisionId: RevisionIdSchema,
    name: nonBlankString,
    description: nonBlankString,
    startNodeId: NodeIdSchema,
    nodes: z.array(WorkflowNodeSchema).min(1).readonly(),
    edges: z.array(WorkflowEdgeSchema).readonly(),
    maxTransitions: z.number().int().positive().safe(),
    createdAt: z.iso.datetime({ offset: true }),
    parentRevisionId: RevisionIdSchema.optional(),
  })
  .readonly()
