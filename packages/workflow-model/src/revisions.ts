import { PREDEFINED_V1_COMMAND_IDS, PREDEFINED_V1_WORKFLOW_ID } from './predefined-v1.js'
import { WorkflowRevisionSchema } from './schemas.js'
import type { AgentNode, PermissionProfile, WorkflowRevision, WorkspacePolicy } from './types.js'
import { validateWorkflow } from './validate-workflow.js'

export const CONFIGURABLE_AGENT_NODE_FIELDS = Object.freeze([
  'provider',
  'model',
  'thinkingLevel',
  'promptTemplate',
  'workspacePolicy',
  'permissionProfile',
  'resourceBundleId',
  'outputSchemaRef',
  'timeoutSeconds',
] as const)

export interface AgentNodeConfigurationChanges {
  readonly provider?: string
  readonly model?: string
  readonly thinkingLevel?: string
  readonly promptTemplate?: string
  readonly workspacePolicy?: WorkspacePolicy
  readonly permissionProfile?: PermissionProfile
  readonly resourceBundleId?: string
  readonly outputSchemaRef?: string
  readonly timeoutSeconds?: number
}

export interface AgentNodeConfigurationUpdate {
  readonly nodeId: string
  readonly changes: AgentNodeConfigurationChanges
}

export interface DerivePredefinedV1RevisionInput {
  readonly revisionId: string
  readonly createdAt: string
  readonly updates: readonly AgentNodeConfigurationUpdate[]
}

export type WorkflowRevisionDerivationErrorCode =
  | 'REVISION_ID_REUSED'
  | 'DUPLICATE_NODE_UPDATE'
  | 'NODE_NOT_FOUND'
  | 'NODE_NOT_AGENT'
  | 'NO_CONFIGURATION_CHANGE'
  | 'INVALID_CONFIGURATION'
  | 'POLICY_INVARIANT_VIOLATION'

export class WorkflowRevisionDerivationError extends Error {
  override readonly name = 'WorkflowRevisionDerivationError'

  constructor(
    readonly code: WorkflowRevisionDerivationErrorCode,
    readonly path: readonly (string | number)[],
    message: string,
  ) {
    super(message)
  }
}

const allowedConfigurationFields = new Set<string>(CONFIGURABLE_AGENT_NODE_FIELDS)
const allowedDerivationInputFields = new Set(['revisionId', 'createdAt', 'updates'])
const readOnlyAgentIds = new Set([
  'select-repositories',
  'requirements-review',
  'security-review',
  'simplification-review',
])
const writeAgentIds = new Set(['implement', 'fix-findings'])

function assertPolicyInvariants(revision: WorkflowRevision): void {
  revision.nodes.forEach((node, nodeIndex) => {
    if (node.type !== 'agent') {
      return
    }

    const expectedWorkspacePolicy =
      node.id === 'select-repositories' ? 'candidate-repositories' : 'selected-worktrees'
    if (node.workspacePolicy !== expectedWorkspacePolicy) {
      throw new WorkflowRevisionDerivationError(
        'POLICY_INVARIANT_VIOLATION',
        ['nodes', nodeIndex, 'workspacePolicy'],
        `Node "${node.id}" must use the ${expectedWorkspacePolicy} workspace policy.`,
      )
    }

    const expectedPermission = readOnlyAgentIds.has(node.id)
      ? 'read-only'
      : writeAgentIds.has(node.id)
        ? 'workspace-write'
        : undefined
    if (expectedPermission !== undefined && node.permissionProfile !== expectedPermission) {
      throw new WorkflowRevisionDerivationError(
        'POLICY_INVARIANT_VIOLATION',
        ['nodes', nodeIndex, 'permissionProfile'],
        `Node "${node.id}" must use the ${expectedPermission} permission profile.`,
      )
    }
  })
}

function applyChanges(node: AgentNode, changes: AgentNodeConfigurationChanges): object {
  return { ...node, ...changes }
}

export function derivePredefinedV1Revision(
  parent: WorkflowRevision,
  input: DerivePredefinedV1RevisionInput,
): WorkflowRevision {
  const unsupportedInputField = Object.keys(input).find(
    (field) => !allowedDerivationInputFields.has(field),
  )
  if (unsupportedInputField !== undefined) {
    throw new WorkflowRevisionDerivationError(
      'INVALID_CONFIGURATION',
      [unsupportedInputField],
      `Field "${unsupportedInputField}" cannot override the predefined workflow.`,
    )
  }
  if (input.revisionId === parent.revisionId) {
    throw new WorkflowRevisionDerivationError(
      'REVISION_ID_REUSED',
      ['revisionId'],
      'A derived revision must use a new revision ID.',
    )
  }
  if (parent.workflowId !== PREDEFINED_V1_WORKFLOW_ID) {
    throw new WorkflowRevisionDerivationError(
      'INVALID_CONFIGURATION',
      ['workflowId'],
      'The parent is not a predefined V1 workflow revision.',
    )
  }

  const updatesByNodeId = new Map<
    string,
    { readonly changes: AgentNodeConfigurationChanges; readonly updateIndex: number }
  >()
  input.updates.forEach((update, updateIndex) => {
    if (updatesByNodeId.has(update.nodeId)) {
      throw new WorkflowRevisionDerivationError(
        'DUPLICATE_NODE_UPDATE',
        ['updates', updateIndex, 'nodeId'],
        `Node "${update.nodeId}" is updated more than once.`,
      )
    }
    const unsupportedField = Object.keys(update.changes).find(
      (field) => !allowedConfigurationFields.has(field),
    )
    if (unsupportedField !== undefined) {
      throw new WorkflowRevisionDerivationError(
        'INVALID_CONFIGURATION',
        ['updates', updateIndex, 'changes', unsupportedField],
        `Field "${unsupportedField}" is not configurable.`,
      )
    }
    updatesByNodeId.set(update.nodeId, { changes: update.changes, updateIndex })
  })

  let hasConfigurationChange = false
  const nodes = parent.nodes.map((node) => {
    const update = updatesByNodeId.get(node.id)
    if (update === undefined) {
      return node
    }
    updatesByNodeId.delete(node.id)
    if (node.type !== 'agent') {
      throw new WorkflowRevisionDerivationError(
        'NODE_NOT_AGENT',
        ['updates', update.updateIndex, 'nodeId'],
        `Node "${node.id}" is not an agent node.`,
      )
    }

    const changed = Object.entries(update.changes).some(
      ([field, value]) => node[field as keyof AgentNode] !== value,
    )
    hasConfigurationChange ||= changed
    return applyChanges(node, update.changes)
  })

  const missingUpdate = updatesByNodeId.entries().next().value as
    | readonly [
        string,
        { readonly changes: AgentNodeConfigurationChanges; readonly updateIndex: number },
      ]
    | undefined
  if (missingUpdate !== undefined) {
    throw new WorkflowRevisionDerivationError(
      'NODE_NOT_FOUND',
      ['updates', missingUpdate[1].updateIndex, 'nodeId'],
      `Node "${missingUpdate[0]}" does not exist.`,
    )
  }
  if (!hasConfigurationChange) {
    throw new WorkflowRevisionDerivationError(
      'NO_CONFIGURATION_CHANGE',
      ['updates'],
      'At least one configurable field must change.',
    )
  }

  const parsed = WorkflowRevisionSchema.safeParse({
    ...parent,
    revisionId: input.revisionId,
    parentRevisionId: parent.revisionId,
    createdAt: input.createdAt,
    nodes,
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new WorkflowRevisionDerivationError(
      'INVALID_CONFIGURATION',
      issue?.path.map((segment) =>
        typeof segment === 'string' || typeof segment === 'number' ? segment : String(segment),
      ) ?? ['updates'],
      issue?.message ?? 'The derived workflow revision is invalid.',
    )
  }

  assertPolicyInvariants(parsed.data)
  const validation = validateWorkflow(parsed.data, {
    registeredCommandIds: new Set(PREDEFINED_V1_COMMAND_IDS),
  })
  if (!validation.valid) {
    const finding = validation.findings[0]
    throw new WorkflowRevisionDerivationError(
      'INVALID_CONFIGURATION',
      finding?.path ?? ['updates'],
      finding?.message ?? 'The derived workflow revision is invalid.',
    )
  }
  return validation.workflow
}
