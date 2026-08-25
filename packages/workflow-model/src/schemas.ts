import {
  HarnessIdSchema,
  HarnessThinkingLevelSchema,
  NodeIdSchema,
  OutcomeNameSchema,
  RepositoryIdSchema,
  WorkflowIdSchema,
} from '@slopify/contracts'
import { z } from 'zod'

const nonBlankString = z.string().trim().min(1)
const promptTemplate = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: 'Prompt template must not be blank',
  })
export const AgentHarnessConfigurationSchema = z
  .strictObject({
    harnessId: HarnessIdSchema,
    modelId: nonBlankString.max(256).optional(),
    thinkingLevel: HarnessThinkingLevelSchema.optional(),
  })
  .readonly()

export const AgentNodeSchema = z
  .strictObject({
    type: z.literal('agent'),
    id: NodeIdSchema,
    name: nonBlankString,
    prompt: promptTemplate,
    harness: AgentHarnessConfigurationSchema,
  })
  .readonly()

export const WorkflowEdgeSchema = z
  .strictObject({
    sourceNodeId: NodeIdSchema,
    outcome: OutcomeNameSchema,
    targetNodeId: NodeIdSchema,
    label: nonBlankString,
  })
  .readonly()

export const WorkflowVariableNameSchema = z.string().trim().min(1).max(128)
export const WorkflowNameSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Use 1–100 lowercase letters, numbers, and single hyphens',
  })

export const WorkflowConfigurationSchema = z
  .strictObject({
    repositoryIds: z.array(RepositoryIdSchema).max(32).readonly(),
    primaryRepositoryId: RepositoryIdSchema.nullable(),
    variables: z.array(WorkflowVariableNameSchema).max(128).readonly(),
  })
  .superRefine((configuration, context) => {
    if (new Set(configuration.repositoryIds).size !== configuration.repositoryIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['repositoryIds'],
        message: 'Repositories must be unique',
      })
    }
    if (new Set(configuration.variables).size !== configuration.variables.length) {
      context.addIssue({
        code: 'custom',
        path: ['variables'],
        message: 'Variables must be unique',
      })
    }
    if (configuration.repositoryIds.length === 0 && configuration.primaryRepositoryId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['primaryRepositoryId'],
        message: 'A workflow without repositories cannot have a primary repository',
      })
    }
    if (configuration.repositoryIds.length > 0 && configuration.primaryRepositoryId === null) {
      context.addIssue({
        code: 'custom',
        path: ['primaryRepositoryId'],
        message: 'A workflow with repositories must have a primary repository',
      })
    }
    if (
      configuration.primaryRepositoryId !== null &&
      !configuration.repositoryIds.includes(configuration.primaryRepositoryId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['primaryRepositoryId'],
        message: 'The primary repository must be selected for the workflow',
      })
    }
  })
  .readonly()

export const CreateWorkflowInputSchema = z
  .strictObject({
    name: WorkflowNameSchema,
    description: nonBlankString,
    configuration: WorkflowConfigurationSchema,
  })
  .readonly()

export const WorkflowSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    workflowId: WorkflowIdSchema,
    name: nonBlankString,
    description: nonBlankString,
    configuration: WorkflowConfigurationSchema,
    startNodeId: NodeIdSchema.nullable(),
    nodes: z.array(AgentNodeSchema).readonly(),
    edges: z.array(WorkflowEdgeSchema).readonly(),
    maxTransitions: z.number().int().nonnegative().safe(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .readonly()
