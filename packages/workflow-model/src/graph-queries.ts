import type { NodeId } from '@slopify/contracts'

import type { Workflow, WorkflowEdge } from './types.js'

export function getIncomingEdges(workflow: Workflow, nodeId: NodeId): readonly WorkflowEdge[] {
  return Object.freeze(workflow.edges.filter((edge) => edge.targetNodeId === nodeId))
}

export function getOutgoingEdges(workflow: Workflow, nodeId: NodeId): readonly WorkflowEdge[] {
  return Object.freeze(workflow.edges.filter((edge) => edge.sourceNodeId === nodeId))
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
