import dagre from '@dagrejs/dagre'

import type { NodeExecutionStatus } from '@slopify/contracts'
import type { Workflow } from '@slopify/workflow-model'

import type { WorkflowNodeData } from '@/components/workflow/workflow-node'

export const WORKFLOW_NODE_WIDTH = 224
export const WORKFLOW_NODE_HEIGHT = 128

const GRAPH_PADDING = 48

export interface WorkflowGraphNode {
  readonly id: string
  readonly data: WorkflowNodeData
  readonly position: Readonly<{ x: number; y: number }>
  readonly ariaLabel: string
}

export interface WorkflowGraphEdge {
  readonly id: string
  readonly sourceNodeId: string
  readonly targetNodeId: string
  readonly outcome: string
  readonly label: string
  readonly points: readonly Readonly<{ x: number; y: number }>[]
}

export interface WorkflowGraphLayout {
  readonly nodes: readonly WorkflowGraphNode[]
  readonly edges: readonly WorkflowGraphEdge[]
  readonly width: number
  readonly height: number
}

export function layoutWorkflowGraph(
  workflow: Workflow,
  options: Readonly<{
    recentRunStatuses?: Readonly<Record<string, NodeExecutionStatus>>
  }> = {},
): WorkflowGraphLayout {
  if (workflow.nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 }

  const visibleNodeIds = new Set(workflow.nodes.map(({ id }) => id))
  const visibleEdges = workflow.edges.filter(
    ({ sourceNodeId, targetNodeId }) =>
      visibleNodeIds.has(sourceNodeId) && visibleNodeIds.has(targetNodeId),
  )
  const nodesWithOutgoingEdges = new Set(visibleEdges.map(({ sourceNodeId }) => sourceNodeId))
  const graph = new dagre.graphlib.Graph({ multigraph: true })
    .setGraph({
      acyclicer: 'greedy',
      edgesep: 24,
      nodesep: 48,
      rankdir: 'TB',
      ranksep: 96,
    })
    .setDefaultEdgeLabel(() => ({}))

  for (const node of workflow.nodes) {
    graph.setNode(node.id, { height: WORKFLOW_NODE_HEIGHT, width: WORKFLOW_NODE_WIDTH })
  }
  visibleEdges.forEach((edge, index) => {
    graph.setEdge(edge.sourceNodeId, edge.targetNodeId, {}, `${index}:${edge.outcome}`)
  })
  dagre.layout(graph)

  const nodes = workflow.nodes.map((domainNode): WorkflowGraphNode => {
    const position = graph.node(domainNode.id)
    const isStart = domainNode.id === workflow.startNodeId
    const isEnd = !nodesWithOutgoingEdges.has(domainNode.id)
    const recentRunStatus = options.recentRunStatuses?.[domainNode.id]

    return {
      id: domainNode.id,
      data: {
        domainNode,
        isStart,
        isEnd,
        ...(recentRunStatus === undefined ? {} : { recentRunStatus }),
      },
      position: {
        x: position.x - WORKFLOW_NODE_WIDTH / 2 + GRAPH_PADDING,
        y: position.y - WORKFLOW_NODE_HEIGHT / 2 + GRAPH_PADDING,
      },
      ariaLabel: `${domainNode.name}, agent node${isStart ? ', start node' : ''}${isEnd ? ', end node' : ''}`,
    }
  })

  const edges = visibleEdges.map((edge, index): WorkflowGraphEdge => {
    const name = `${index}:${edge.outcome}`
    const laidOutEdge = graph.edge({ v: edge.sourceNodeId, w: edge.targetNodeId, name })

    return {
      id: `${index}:${edge.sourceNodeId}:${edge.outcome}:${edge.targetNodeId}`,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      outcome: edge.outcome,
      label: edge.label,
      points: (laidOutEdge?.points ?? []).map(({ x, y }: { x: number; y: number }) => ({
        x: x + GRAPH_PADDING,
        y: y + GRAPH_PADDING,
      })),
    }
  })
  const dimensions = graph.graph()

  return {
    nodes,
    edges,
    width: (dimensions.width ?? WORKFLOW_NODE_WIDTH) + GRAPH_PADDING * 2,
    height: (dimensions.height ?? WORKFLOW_NODE_HEIGHT) + GRAPH_PADDING * 2,
  }
}
