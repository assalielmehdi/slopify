import type { z } from 'zod'

import type {
  AgentHarnessConfigurationSchema,
  AgentNodeSchema,
  CreateWorkflowInputSchema,
  WorkflowEdgeSchema,
  WorkflowConfigurationSchema,
  WorkflowVariableNameSchema,
  WorkflowSchema,
} from './schemas.js'

export type AgentHarnessConfiguration = z.infer<typeof AgentHarnessConfigurationSchema>
export type AgentNode = z.infer<typeof AgentNodeSchema>
export type CreateWorkflowInput = z.infer<typeof CreateWorkflowInputSchema>
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>
export type WorkflowConfiguration = z.infer<typeof WorkflowConfigurationSchema>
export type WorkflowVariableName = z.infer<typeof WorkflowVariableNameSchema>
export type Workflow = z.infer<typeof WorkflowSchema>
