import {
  HarnessIdSchema,
  HarnessThinkingLevelSchema,
  NodeIdSchema,
  OutcomeNameSchema,
  ProjectIdSchema,
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

export const WorkflowConfigurationSchema = z
  .strictObject({
    projectIds: z.array(ProjectIdSchema).max(32).readonly(),
    primaryProjectId: ProjectIdSchema.nullable(),
    variables: z.array(WorkflowVariableNameSchema).max(128).readonly(),
  })
  .superRefine((configuration, context) => {
    if (new Set(configuration.projectIds).size !== configuration.projectIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['projectIds'],
        message: 'Projects must be unique',
      })
    }
    if (new Set(configuration.variables).size !== configuration.variables.length) {
      context.addIssue({
        code: 'custom',
        path: ['variables'],
        message: 'Variables must be unique',
      })
    }
    if (configuration.projectIds.length === 0 && configuration.primaryProjectId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['primaryProjectId'],
        message: 'A workflow without projects cannot have a primary project',
      })
    }
    if (configuration.projectIds.length > 0 && configuration.primaryProjectId === null) {
      context.addIssue({
        code: 'custom',
        path: ['primaryProjectId'],
        message: 'A workflow with projects must have a primary project',
      })
    }
    if (
      configuration.primaryProjectId !== null &&
      !configuration.projectIds.includes(configuration.primaryProjectId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['primaryProjectId'],
        message: 'The primary project must be selected for the workflow',
      })
    }
  })
  .readonly()

export const CreateWorkflowInputSchema = z
  .strictObject({
    name: nonBlankString,
    description: nonBlankString,
    configuration: WorkflowConfigurationSchema,
  })
  .readonly()

export const WorkflowSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
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
