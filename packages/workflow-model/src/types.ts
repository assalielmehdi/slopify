import type { z } from 'zod'

import type {
  AgentNodeSchema,
  CreateWorkflowInputSchema,
  WorkflowEdgeSchema,
  WorkflowFileSchema,
  WorkflowGraphSchema,
  WorkflowConfigurationSchema,
  WorkflowSchema,
} from './schemas.js'

export type AgentNode = z.infer<typeof AgentNodeSchema>
export type CreateWorkflowInput = z.infer<typeof CreateWorkflowInputSchema>
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>
export type WorkflowFile = z.infer<typeof WorkflowFileSchema>
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>
export type WorkflowConfiguration = z.infer<typeof WorkflowConfigurationSchema>
export type Workflow = z.infer<typeof WorkflowSchema>
