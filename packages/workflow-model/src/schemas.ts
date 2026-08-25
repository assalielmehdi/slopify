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
export const WorkflowSlugSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Use 1–64 lowercase letters, numbers, and single hyphens',
  })

const repositoryIdsSchema = z.array(RepositoryIdSchema).max(32).readonly()
const workflowVariablesSchema = z.array(WorkflowVariableNameSchema).max(128).readonly()

function validateRepositorySelection(
  selection: {
    readonly repositoryIds: readonly string[]
    readonly primaryRepositoryId: string | null
  },
  context: z.RefinementCtx,
): void {
  if (new Set(selection.repositoryIds).size !== selection.repositoryIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['repositoryIds'],
      message: 'Repositories must be unique',
    })
  }
  if (selection.repositoryIds.length === 0 && selection.primaryRepositoryId !== null) {
    context.addIssue({
      code: 'custom',
      path: ['primaryRepositoryId'],
      message: 'A workflow without repositories cannot have a primary repository',
    })
  }
  if (selection.repositoryIds.length > 0 && selection.primaryRepositoryId === null) {
    context.addIssue({
      code: 'custom',
      path: ['primaryRepositoryId'],
      message: 'A workflow with repositories must have a primary repository',
    })
  }
  if (
    selection.primaryRepositoryId !== null &&
    !selection.repositoryIds.includes(selection.primaryRepositoryId)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['primaryRepositoryId'],
      message: 'The primary repository must be selected for the workflow',
    })
  }
}

export const WorkflowConfigurationSchema = z
  .strictObject({
    repositoryIds: repositoryIdsSchema,
    primaryRepositoryId: RepositoryIdSchema.nullable(),
    variables: workflowVariablesSchema,
  })
  .superRefine((configuration, context) => {
    validateRepositorySelection(configuration, context)
    if (new Set(configuration.variables).size !== configuration.variables.length) {
      context.addIssue({
        code: 'custom',
        path: ['variables'],
        message: 'Variables must be unique',
      })
    }
  })
  .readonly()

export const WorkflowRepositoriesSchema = z
  .strictObject({
    repositoryIds: repositoryIdsSchema,
    primaryRepositoryId: RepositoryIdSchema.nullable(),
  })
  .superRefine(validateRepositorySelection)
  .readonly()

export const WorkflowGraphSchema = z
  .strictObject({
    startNodeId: NodeIdSchema.nullable(),
    nodes: z.array(AgentNodeSchema).readonly(),
    edges: z.array(WorkflowEdgeSchema).readonly(),
    maxTransitions: z.number().int().nonnegative().safe(),
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

export const WorkflowFileSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    workflowId: WorkflowSlugSchema,
    name: nonBlankString,
    description: nonBlankString,
    repositories: WorkflowRepositoriesSchema,
    variables: workflowVariablesSchema.superRefine((variables, context) => {
      if (new Set(variables).size !== variables.length) {
        context.addIssue({
          code: 'custom',
          message: 'Variables must be unique',
        })
      }
    }),
    graph: WorkflowGraphSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .readonly()
