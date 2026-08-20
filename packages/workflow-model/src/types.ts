import type { z } from 'zod'

import type {
  AgentInferenceConfigurationSchema,
  AgentJobDefinitionSchema,
  AgentNodeSchema,
  CommandNodeSchema,
  PermissionProfileSchema,
  ResourceBundleIdSchema,
  ResultContractSchema,
  RouterNodeSchema,
  SandboxReferenceSchema,
  SkillSnapshotReferenceSchema,
  TerminalNodeSchema,
  TerminalStatusSchema,
  WorkflowEdgeSchema,
  WorkflowNodeSchema,
  WorkflowRevisionSchema,
  WorkspacePolicySchema,
} from './schemas.js'

export type ResourceBundleId = z.infer<typeof ResourceBundleIdSchema>
export type SkillSnapshotReference = z.infer<typeof SkillSnapshotReferenceSchema>
export type AgentInferenceConfiguration = z.infer<typeof AgentInferenceConfigurationSchema>
export type AgentJobDefinition = z.infer<typeof AgentJobDefinitionSchema>
export type ResultContract = z.infer<typeof ResultContractSchema>
export type SandboxReference = z.infer<typeof SandboxReferenceSchema>
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
