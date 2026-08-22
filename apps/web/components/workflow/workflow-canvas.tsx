'use client'

import type { NodeExecutionStatus } from '@slopify/contracts'
import type { AgentNode, Workflow } from '@slopify/workflow-model'
import dagre from '@dagrejs/dagre'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
  type OnNodesChange,
} from '@xyflow/react'
import { useCallback, useMemo } from 'react'

import '@xyflow/react/dist/style.css'

import { WorkflowNode, type WorkflowCanvasNode, type WorkflowNodeData } from './workflow-node'

const NODE_WIDTH = 224
const NODE_HEIGHT = 128

export interface WorkflowGraphLayout {
  readonly nodes: WorkflowCanvasNode[]
  readonly edges: Edge[]
}

export interface WorkflowCanvasProps {
  readonly workflow: Workflow
  readonly selectedNodeId?: string | null | undefined
  readonly onNodeSelect: (nodeId: string) => void
  readonly recentRunStatuses?: Readonly<Record<string, NodeExecutionStatus>>
}

const nodeTypes = { workflow: WorkflowNode } satisfies NodeTypes

export function layoutWorkflowGraph(
  workflow: Workflow,
  options: Readonly<{
    selectedNodeId?: string | null | undefined
    recentRunStatuses?: Readonly<Record<string, NodeExecutionStatus>>
  }> = {},
): WorkflowGraphLayout {
  const visibleNodes = workflow.nodes.filter((node): node is AgentNode => node.type === 'agent')
  const visibleNodeIds = new Set(visibleNodes.map(({ id }) => id))
  const visibleEdges = workflow.edges.filter(
    ({ sourceNodeId, targetNodeId }) =>
      visibleNodeIds.has(sourceNodeId) && visibleNodeIds.has(targetNodeId),
  )
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
    const data: WorkflowNodeData = {
      domainNode,
      isStart: domainNode.id === workflow.startNodeId,
      ...(options.recentRunStatuses?.[domainNode.id] === undefined
        ? {}
        : { recentRunStatus: options.recentRunStatuses[domainNode.id] }),
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
      connectable: false,
      deletable: false,
      focusable: true,
      ariaLabel: `${domainNode.name}, ${domainNode.type} node${data.isStart ? ', start node' : ''}`,
      ariaRole: 'button',
    }
  })

  const edges = visibleEdges.map((edge, index): Edge => ({
    id: `${index}:${edge.sourceNodeId}:${edge.outcome}:${edge.targetNodeId}`,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: `${edge.outcome}: ${edge.label}`,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
    focusable: true,
    reconnectable: false,
    ariaLabel: `${edge.sourceNodeId} to ${edge.targetNodeId}: ${edge.outcome}, ${edge.label}`,
  }))

  return { nodes, edges }
}

export function WorkflowCanvas({
  workflow,
  selectedNodeId,
  onNodeSelect,
  recentRunStatuses,
}: WorkflowCanvasProps) {
  const graph = useMemo(
    () =>
      layoutWorkflowGraph(workflow, {
        selectedNodeId,
        ...(recentRunStatuses === undefined ? {} : { recentRunStatuses }),
      }),
    [recentRunStatuses, selectedNodeId, workflow],
  )
  const handleNodeClick = useCallback<NodeMouseHandler<WorkflowCanvasNode>>(
    (_event, node) => onNodeSelect(node.id),
    [onNodeSelect],
  )
  const handleNodesChange = useCallback<OnNodesChange<WorkflowCanvasNode>>(
    (changes) => {
      for (const change of changes) {
        if (change.type === 'select' && change.selected) {
          onNodeSelect(change.id)
          return
        }
      }
    },
    [onNodeSelect],
  )

  if (graph.nodes.length === 0) {
    return (
      <div
        className="workflow-graph grid h-full min-h-0 min-w-0 place-items-center overflow-hidden rounded-lg border bg-card"
        role="region"
        aria-label="Workflow graph"
      >
        <div className="max-w-sm px-6 text-center">
          <p className="text-sm/5 font-medium">No agent jobs</p>
          <p className="mt-1 text-sm/5 text-muted-foreground">
            This workflow is empty and cannot be run yet.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="workflow-graph h-full min-h-0 min-w-0 overflow-hidden rounded-lg border bg-card"
      role="region"
      aria-label="Workflow graph"
    >
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable
        nodesFocusable
        edgesFocusable
        deleteKeyCode={null}
        minZoom={0.25}
        maxZoom={1.5}
        fitView
        fitViewOptions={{ nodes: graph.nodes.slice(0, 4), padding: 0.16, maxZoom: 0.75 }}
        onNodeClick={handleNodeClick}
        onNodesChange={handleNodesChange}
        ariaLabelConfig={{
          'node.a11yDescription.default':
            'Press Enter or Space to inspect this read-only workflow node.',
          'edge.a11yDescription.default': 'Read-only workflow transition.',
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls
          showInteractive={false}
          fitViewOptions={{ padding: 0.16 }}
          aria-label="Workflow viewport controls"
        />
      </ReactFlow>
    </div>
  )
}
