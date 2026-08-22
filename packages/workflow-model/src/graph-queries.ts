import type { NodeId } from '@slopify/contracts'

import type { Workflow, WorkflowEdge } from './types.js'

export interface WorkflowNodeInspection {
  readonly node: Workflow['nodes'][number]
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

export function getIncomingEdges(workflow: Workflow, nodeId: NodeId): readonly WorkflowEdge[] {
  return Object.freeze(workflow.edges.filter((edge) => edge.targetNodeId === nodeId))
}

export function getOutgoingEdges(workflow: Workflow, nodeId: NodeId): readonly WorkflowEdge[] {
  return Object.freeze(workflow.edges.filter((edge) => edge.sourceNodeId === nodeId))
}

export function isLinearAgentWorkflow(workflow: Workflow): boolean {
  if (workflow.nodes.some((node) => node.type !== 'agent')) return false
  if (workflow.nodes.length === 0)
    return workflow.startNodeId === null && workflow.edges.length === 0
  if (workflow.startNodeId === null) return false

  const nodeIds = new Set(workflow.nodes.map((node) => node.id))
  if (!nodeIds.has(workflow.startNodeId)) return false

  const incomingCounts = new Map<NodeId, number>()
  const outgoingTargets = new Map<NodeId, NodeId>()
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) return false
    if (outgoingTargets.has(edge.sourceNodeId)) return false
    outgoingTargets.set(edge.sourceNodeId, edge.targetNodeId)
    incomingCounts.set(edge.targetNodeId, (incomingCounts.get(edge.targetNodeId) ?? 0) + 1)
  }

  if ((incomingCounts.get(workflow.startNodeId) ?? 0) !== 0) return false
  if (
    workflow.nodes.some(
      (node) => node.id !== workflow.startNodeId && (incomingCounts.get(node.id) ?? 0) !== 1,
    )
  )
    return false

  const visited = new Set<NodeId>()
  let current: NodeId | undefined = workflow.startNodeId
  while (current !== undefined && !visited.has(current)) {
    visited.add(current)
    current = outgoingTargets.get(current)
  }

  return current === undefined && visited.size === workflow.nodes.length
}

export function getDeclaredOutcomes(workflow: Workflow, nodeId: NodeId): readonly string[] {
  return Object.freeze([
    ...new Set(getOutgoingEdges(workflow, nodeId).map(({ outcome }) => outcome)),
  ])
}

export function getReachableNodeIds(workflow: Workflow): readonly NodeId[] {
  const knownNodeIds = new Set(workflow.nodes.map((node) => node.id))
  if (workflow.startNodeId === null) {
    return Object.freeze([])
  }
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

export function hasDirectedCycle(workflow: Workflow): boolean {
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

export function inspectWorkflowGraph(workflow: Workflow): WorkflowGraphInspection {
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
