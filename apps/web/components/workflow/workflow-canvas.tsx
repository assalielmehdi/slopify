'use client'

import type { NodeExecutionStatus } from '@slopify/contracts'
import type { AgentNode, Workflow, WorkflowEdge } from '@slopify/workflow-model'
import dagre from '@dagrejs/dagre'
import { PlayIcon } from 'lucide-react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Connection,
  type IsValidConnection,
  type NodeMouseHandler,
  type NodeTypes,
  type OnConnect,
  type OnEdgesDelete,
  type OnNodesChange,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import '@xyflow/react/dist/style.css'

import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { WorkflowNode, type WorkflowCanvasNode, type WorkflowNodeData } from './workflow-node'

const NODE_WIDTH = 224
const NODE_HEIGHT = 128
const runActionClassName =
  't-resize t-resize-intrinsic group/run w-8 justify-start gap-2 overflow-hidden px-2 hover:w-max focus:w-max'

function RunActionContent() {
  return (
    <>
      <PlayIcon aria-hidden="true" className="shrink-0" />
      <span className="shrink-0 opacity-0 transition-opacity duration-[var(--resize-dur)] ease-[var(--resize-ease)] group-hover/run:opacity-100 group-focus/run:opacity-100">
        Run
      </span>
    </>
  )
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'),
  )
}

export interface WorkflowGraphLayout {
  readonly nodes: WorkflowCanvasNode[]
  readonly edges: Edge[]
}

export interface WorkflowCanvasProps {
  readonly workflow: Workflow
  readonly selectedNodeId?: string | null | undefined
  readonly onNodeSelect: (nodeId: string) => void
  readonly onAddAgent?: ((sourceNodeId?: string) => void) | undefined
  readonly onConnect?: ((sourceNodeId: string, targetNodeId: string) => void) | undefined
  readonly onEdgeDelete?: ((edge: WorkflowEdge) => void) | undefined
  readonly recentRunStatuses?: Readonly<Record<string, NodeExecutionStatus>>
  readonly onRun?: (() => void) | undefined
  readonly runnable?: boolean | undefined
}

const nodeTypes = { workflow: WorkflowNode } satisfies NodeTypes

export function layoutWorkflowGraph(
  workflow: Workflow,
  options: Readonly<{
    selectedNodeId?: string | null | undefined
    recentRunStatuses?: Readonly<Record<string, NodeExecutionStatus>>
    editable?: boolean | undefined
    onAddAgent?: ((sourceNodeId: string) => void) | undefined
  }> = {},
): WorkflowGraphLayout {
  const visibleNodes = workflow.nodes.filter((node): node is AgentNode => node.type === 'agent')
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
      ...(options.onAddAgent === undefined || !isEnd
        ? {}
        : { onAddAgent: () => options.onAddAgent?.(domainNode.id) }),
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

export function WorkflowCanvas({
  workflow,
  selectedNodeId,
  onNodeSelect,
  onAddAgent,
  onConnect,
  onEdgeDelete,
  recentRunStatuses,
  onRun,
  runnable = false,
}: WorkflowCanvasProps) {
  const editable = onConnect !== undefined
  const runButtonRef = useRef<HTMLButtonElement>(null)
  const graph = useMemo(
    () =>
      layoutWorkflowGraph(workflow, {
        selectedNodeId,
        editable,
        ...(onAddAgent === undefined ? {} : { onAddAgent }),
        ...(recentRunStatuses === undefined ? {} : { recentRunStatuses }),
      }),
    [editable, onAddAgent, recentRunStatuses, selectedNodeId, workflow],
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
  const handleConnect = useCallback<OnConnect>(
    (connection) => {
      if (connection.source === null || connection.target === null) return
      onConnect?.(connection.source, connection.target)
    },
    [onConnect],
  )
  const handleEdgesDelete = useCallback<OnEdgesDelete>(
    (edges) => {
      for (const edge of edges) {
        const domainEdge = edge.data?.domainEdge as WorkflowEdge | undefined
        if (domainEdge !== undefined) onEdgeDelete?.(domainEdge)
      }
    },
    [onEdgeDelete],
  )
  const isValidConnection = useCallback<IsValidConnection>(
    (candidate: Edge | Connection) => {
      const { source, target } = candidate
      if (source === null || target === null || source === target) return false
      if (target === workflow.startNodeId) return false
      if (workflow.edges.some((edge) => edge.sourceNodeId === source)) return false
      if (workflow.edges.some((edge) => edge.targetNodeId === target)) return false
      return !workflow.edges.some(
        (edge) => edge.sourceNodeId === source && edge.targetNodeId === target,
      )
    },
    [workflow.edges, workflow.startNodeId],
  )

  useEffect(() => {
    if (!runnable || onRun === undefined) return

    const handleRunShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.key.toLowerCase() !== 'r' ||
        isEditableShortcutTarget(event.target)
      ) {
        return
      }

      event.preventDefault()
      runButtonRef.current?.click()
    }

    window.addEventListener('keydown', handleRunShortcut)
    return () => window.removeEventListener('keydown', handleRunShortcut)
  }, [onRun, runnable])

  if (graph.nodes.length === 0) {
    return (
      <div
        className="workflow-graph relative grid h-full min-h-0 min-w-0 place-items-center overflow-hidden bg-background"
        role="region"
        aria-label="Workflow graph"
      >
        {onRun === undefined ? null : (
          <div className="absolute top-3 right-3 z-10">
            <Button
              size="icon-sm"
              aria-label="Run"
              className={runActionClassName}
              disabled
              title="Add an agent before starting a run."
            >
              <RunActionContent />
            </Button>
          </div>
        )}
        <div className="max-w-sm px-6 text-center">
          <p className="text-sm/5 font-medium">No agent jobs</p>
          <p className="mt-1 text-sm/5 text-muted-foreground">
            This workflow is empty and cannot be run yet.
          </p>
          {onAddAgent === undefined ? null : (
            <Button className="mt-4" onClick={() => onAddAgent()}>
              Add your first agent
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className="workflow-graph relative h-full min-h-0 min-w-0 overflow-hidden bg-background"
      role="region"
      aria-label="Workflow graph"
    >
      {onRun === undefined ? null : (
        <div className="absolute top-3 right-3 z-10">
          {runnable ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    ref={runButtonRef}
                    onClick={onRun}
                    size="icon-sm"
                    aria-label="Run"
                    aria-keyshortcuts="R"
                    className={runActionClassName}
                  />
                }
              >
                <RunActionContent />
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" sideOffset={6}>
                Run <Kbd>R</Kbd>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              size="icon-sm"
              aria-label="Run"
              className={runActionClassName}
              disabled
              title="Connect every agent to make this workflow runnable."
            >
              <RunActionContent />
            </Button>
          )}
        </div>
      )}
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={editable}
        edgesReconnectable={false}
        elementsSelectable
        nodesFocusable
        edgesFocusable
        deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
        minZoom={0.25}
        maxZoom={1.5}
        fitView
        fitViewOptions={{ nodes: graph.nodes.slice(0, 4), padding: 0.16, maxZoom: 0.75 }}
        onNodeClick={handleNodeClick}
        onNodesChange={handleNodesChange}
        {...(editable
          ? {
              onConnect: handleConnect,
              onEdgesDelete: handleEdgesDelete,
              isValidConnection,
            }
          : {})}
        ariaLabelConfig={{
          'node.a11yDescription.default': editable
            ? 'Press Enter or Space to select this agent. Use the add control on the end agent to append another agent.'
            : 'Press Enter or Space to inspect this workflow node.',
          'edge.a11yDescription.default': editable
            ? 'Press Enter or Space to select this transition. Press Delete to remove it.'
            : 'Workflow transition.',
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
