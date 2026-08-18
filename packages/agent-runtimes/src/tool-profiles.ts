import { PermissionProfileSchema, type PermissionProfile } from '@loop/workflow-model'

export type AgentToolName =
  | 'read'
  | 'bash'
  | 'edit'
  | 'write'
  | 'grep'
  | 'find'
  | 'ls'
  | 'complete_node'

export type AgentToolProfile = readonly AgentToolName[]

const readOnlyTools: AgentToolProfile = Object.freeze([
  'read',
  'grep',
  'find',
  'ls',
  'complete_node',
])

const workspaceWriteTools: AgentToolProfile = Object.freeze([
  'read',
  'bash',
  'edit',
  'write',
  'grep',
  'find',
  'ls',
  'complete_node',
])

export const AGENT_TOOL_PROFILES: Readonly<Record<PermissionProfile, AgentToolProfile>> =
  Object.freeze({
    'read-only': readOnlyTools,
    'workspace-write': workspaceWriteTools,
  })

export const getAgentToolProfile = (profile: PermissionProfile): AgentToolProfile => {
  const parsed = PermissionProfileSchema.safeParse(profile)
  if (!parsed.success) throw new TypeError('Unknown agent permission profile')
  return AGENT_TOOL_PROFILES[parsed.data]
}
