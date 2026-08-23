import dagre from '@dagrejs/dagre'
import { MarkerType, type Edge } from '@xyflow/react'

import type { NodeExecutionStatus } from '@slopify/contracts'
import type { Workflow } from '@slopify/workflow-model'

import type { WorkflowCanvasNode, WorkflowNodeData } from '@/components/workflow/workflow-node'

const NODE_WIDTH = 224
const NODE_HEIGHT = 128

export interface WorkflowGraphLayout {
  readonly nodes: WorkflowCanvasNode[]
  readonly edges: Edge[]
}

export function layoutWorkflowGraph(
  workflow: Workflow,
  options: Readonly<{
    selectedNodeId?: string | null | undefined
    recentRunStatuses?: Readonly<Record<string, NodeExecutionStatus>>
    editable?: boolean | undefined
    onAddAgent?: ((sourceNodeId: string) => void) | undefined
    addAgentDisabledReason?: string | undefined
  }> = {},
): WorkflowGraphLayout {
  const visibleNodes = workflow.nodes
  const visibleNodeIds = new Set(visibleNodes.map(({ id }) => id))
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

  for (const node of visibleNodes) {
    graph.setNode(node.id, { height: NODE_HEIGHT, width: NODE_WIDTH })
  }
  visibleEdges.forEach((edge, index) => {
    graph.setEdge(edge.sourceNodeId, edge.targetNodeId, {}, `${index}:${edge.outcome}`)
  })
  dagre.layout(graph)

  const nodes = visibleNodes.map((domainNode): WorkflowCanvasNode => {
    const position = graph.node(domainNode.id)
    const isEnd = !nodesWithOutgoingEdges.has(domainNode.id)
    const data: WorkflowNodeData = {
      domainNode,
      isStart: domainNode.id === workflow.startNodeId,
      isEnd,
      ...(options.recentRunStatuses?.[domainNode.id] === undefined
        ? {}
        : { recentRunStatus: options.recentRunStatuses[domainNode.id] }),
      ...(options.onAddAgent === undefined
        ? {}
        : { onAddAgent: () => options.onAddAgent?.(domainNode.id) }),
      ...(options.addAgentDisabledReason === undefined
        ? {}
        : { addAgentDisabledReason: options.addAgentDisabledReason }),
    }

    return {
      id: domainNode.id,
      type: 'workflow',
      data,
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
      },
      selected: domainNode.id === options.selectedNodeId,
      draggable: false,
      connectable: options.editable ?? false,
      deletable: false,
      focusable: true,
      ariaLabel: `${domainNode.name}, ${domainNode.type} node${data.isStart ? ', start node' : ''}${data.isEnd ? ', end node' : ''}`,
      ariaRole: 'button',
    }
  })

  const edges = visibleEdges.map((edge, index): Edge => ({
    id: `${index}:${edge.sourceNodeId}:${edge.outcome}:${edge.targetNodeId}`,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
    focusable: true,
    reconnectable: false,
    deletable: options.editable ?? false,
    data: { domainEdge: edge },
    ariaLabel: `${edge.sourceNodeId} to ${edge.targetNodeId}: ${edge.outcome}, ${edge.label}`,
  }))

  return { nodes, edges }
}
