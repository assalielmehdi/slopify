import type { NodeId } from '@loop/contracts'

import type { AgentNode, WorkflowEdge, WorkflowRevision } from './types.js'

export interface WorkflowNodeInspection {
  readonly node: WorkflowRevision['nodes'][number]
  readonly isStart: boolean
  readonly isTerminal: boolean
  readonly isReachable: boolean
  readonly incomingEdges: readonly WorkflowEdge[]
  readonly outgoingEdges: readonly WorkflowEdge[]
}

export interface WorkflowGraphInspection {
  readonly hasCycle: boolean
  readonly nodes: readonly WorkflowNodeInspection[]
}

export function getIncomingEdges(
  workflow: WorkflowRevision,
  nodeId: NodeId,
): readonly WorkflowEdge[] {
  return Object.freeze(workflow.edges.filter((edge) => edge.targetNodeId === nodeId))
}

export function getOutgoingEdges(
  workflow: WorkflowRevision,
  nodeId: NodeId,
): readonly WorkflowEdge[] {
  return Object.freeze(workflow.edges.filter((edge) => edge.sourceNodeId === nodeId))
}

export function getDeclaredOutcomes(workflow: WorkflowRevision, nodeId: NodeId): readonly string[] {
  return Object.freeze([
    ...new Set(getOutgoingEdges(workflow, nodeId).map(({ outcome }) => outcome)),
  ])
}

/**
 * Transitional view used only by the source-controlled delivery executors while they
 * are moved behind the generic JobRunner port. It is derived from the nested job and
 * graph and is never persisted in a workflow revision.
 */
export function getAgentNodeRuntimeConfiguration(
  workflow: WorkflowRevision,
  node: AgentNode,
): Readonly<{
  provider: string
  model: string
  thinkingLevel: string
  promptTemplate: string
  workspacePolicy: 'candidate-repositories' | 'selected-worktrees'
  permissionProfile: 'read-only' | 'workspace-write'
  resourceBundleId: string
  inputArtifacts: readonly string[]
  outputSchemaRef: string
  outcomes: readonly string[]
  timeoutSeconds: number
}> {
  const readOnlyNodeIds = new Set([
    'select-repositories',
    'plan',
    'requirements-review',
    'security-review',
    'simplification-review',
  ])
  const inputArtifactsByNodeId: Readonly<Record<string, readonly string[]>> = {
    implement: ['EXECUTION_PLAN'],
    'requirements-review': ['EXECUTION_PLAN', 'IMPLEMENTATION_SUMMARY'],
    'security-review': ['EXECUTION_PLAN', 'IMPLEMENTATION_SUMMARY'],
    'simplification-review': ['EXECUTION_PLAN', 'IMPLEMENTATION_SUMMARY'],
    'fix-findings': ['REVIEW_SUMMARY'],
  }
  const resourceBundleByNodeId: Readonly<Record<string, string>> = {
    'select-repositories': 'repository-selection-v1',
    plan: 'delivery-planning-v1',
    implement: 'delivery-implementation-v1',
    'requirements-review': 'requirements-review-v1',
    'security-review': 'security-review-v1',
    'simplification-review': 'simplification-review-v1',
    'fix-findings': 'finding-resolution-v1',
  }
  const connectionId = node.job.inference.connectionId
  const provider = connectionId.endsWith('-default')
    ? connectionId.slice(0, -'-default'.length)
    : connectionId.startsWith('chatgpt')
      ? 'openai-codex'
      : 'openrouter'

  return Object.freeze({
    provider,
    model: node.job.inference.modelId,
    thinkingLevel: node.job.inference.thinkingLevel,
    promptTemplate: node.job.prompt,
    workspacePolicy:
      node.id === 'select-repositories' ? 'candidate-repositories' : 'selected-worktrees',
    permissionProfile: readOnlyNodeIds.has(node.id) ? 'read-only' : 'workspace-write',
    resourceBundleId:
      node.job.skillSnapshotRefs[0]?.skillId ??
      resourceBundleByNodeId[node.id] ??
      'empty-skill-set',
    inputArtifacts: inputArtifactsByNodeId[node.id] ?? [],
    outputSchemaRef: node.result.schemaRef,
    outcomes: getDeclaredOutcomes(workflow, node.id),
    timeoutSeconds: node.timeoutSeconds,
  })
}

export function getReachableNodeIds(workflow: WorkflowRevision): readonly NodeId[] {
  const knownNodeIds = new Set(workflow.nodes.map((node) => node.id))
  if (!knownNodeIds.has(workflow.startNodeId)) {
    return Object.freeze([])
  }

  const reachable = new Set<NodeId>()
  const pending: NodeId[] = [workflow.startNodeId]

  for (const nodeId of pending) {
    if (reachable.has(nodeId)) {
      continue
    }

    reachable.add(nodeId)
    for (const edge of workflow.edges) {
      if (
        edge.sourceNodeId === nodeId &&
        knownNodeIds.has(edge.targetNodeId) &&
        !reachable.has(edge.targetNodeId)
      ) {
        pending.push(edge.targetNodeId)
      }
    }
  }

  return Object.freeze(
    workflow.nodes.filter((node) => reachable.has(node.id)).map((node) => node.id),
  )
}

export function hasDirectedCycle(workflow: WorkflowRevision): boolean {
  const knownNodeIds = new Set(workflow.nodes.map((node) => node.id))
  const adjacency = new Map<NodeId, readonly NodeId[]>()

  for (const node of workflow.nodes) {
    adjacency.set(
      node.id,
      workflow.edges
        .filter((edge) => edge.sourceNodeId === node.id && knownNodeIds.has(edge.targetNodeId))
        .map((edge) => edge.targetNodeId),
    )
  }

  const visiting = new Set<NodeId>()
  const visited = new Set<NodeId>()

  const visit = (nodeId: NodeId): boolean => {
    if (visiting.has(nodeId)) {
      return true
    }
    if (visited.has(nodeId)) {
      return false
    }

    visiting.add(nodeId)
    for (const targetNodeId of adjacency.get(nodeId) ?? []) {
      if (visit(targetNodeId)) {
        return true
      }
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }

  return workflow.nodes.some((node) => visit(node.id))
}

export function inspectWorkflowGraph(workflow: WorkflowRevision): WorkflowGraphInspection {
  const reachableNodeIds = new Set(getReachableNodeIds(workflow))
  const nodes = workflow.nodes.map((node) =>
    Object.freeze({
      node,
      isStart: node.id === workflow.startNodeId,
      isTerminal: node.type === 'terminal',
      isReachable: reachableNodeIds.has(node.id),
      incomingEdges: getIncomingEdges(workflow, node.id),
      outgoingEdges: getOutgoingEdges(workflow, node.id),
    }),
  )

  return Object.freeze({
    hasCycle: hasDirectedCycle(workflow),
    nodes: Object.freeze(nodes),
  })
}
