import type { z } from 'zod'

import type {
  AgentNodeSchema,
  CommandNodeSchema,
  PermissionProfileSchema,
  ResourceBundleIdSchema,
  RouterNodeSchema,
  TerminalNodeSchema,
  TerminalStatusSchema,
  WorkflowEdgeSchema,
  WorkflowNodeSchema,
  WorkflowRevisionSchema,
  WorkspacePolicySchema,
} from './schemas.js'

export type ResourceBundleId = z.infer<typeof ResourceBundleIdSchema>
export type WorkspacePolicy = z.infer<typeof WorkspacePolicySchema>
export type PermissionProfile = z.infer<typeof PermissionProfileSchema>
export type TerminalStatus = z.infer<typeof TerminalStatusSchema>
export type AgentNode = z.infer<typeof AgentNodeSchema>
export type CommandNode = z.infer<typeof CommandNodeSchema>
export type RouterNode = z.infer<typeof RouterNodeSchema>
export type TerminalNode = z.infer<typeof TerminalNodeSchema>
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>
export type WorkflowRevision = z.infer<typeof WorkflowRevisionSchema>
