'use client'

import type { NodeExecutionStatus } from '@slopify/contracts'
import type { Workflow, WorkflowEdge } from '@slopify/workflow-model'
import { PlayIcon, Settings2Icon } from 'lucide-react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
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
import { layoutWorkflowGraph } from '@/lib/workflow-graph-layout'

import { WorkflowNode, type WorkflowCanvasNode } from './workflow-node'

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

export interface WorkflowCanvasProps {
  readonly workflow: Workflow
  readonly selectedNodeId?: string | null | undefined
  readonly onNodeSelect: (nodeId: string) => void
  readonly onAddAgent?: ((sourceNodeId?: string) => void) | undefined
  readonly onConnect?: ((sourceNodeId: string, targetNodeId: string) => void) | undefined
  readonly onEdgeDelete?: ((edge: WorkflowEdge) => void) | undefined
  readonly recentRunStatuses?: Readonly<Record<string, NodeExecutionStatus>>
  readonly onRun?: (() => void) | undefined
  readonly onConfigure?: (() => void) | undefined
  readonly runnable?: boolean | undefined
  readonly addAgentDisabledReason?: string | undefined
  readonly runDisabledReason?: string | undefined
}

const nodeTypes = { workflow: WorkflowNode } satisfies NodeTypes

export function WorkflowCanvas({
  workflow,
  selectedNodeId,
  onNodeSelect,
  onAddAgent,
  onConnect,
  onEdgeDelete,
  recentRunStatuses,
  onRun,
  onConfigure,
  runnable = false,
  addAgentDisabledReason,
  runDisabledReason,
}: WorkflowCanvasProps) {
  const editable = onConnect !== undefined
  const runButtonRef = useRef<HTMLButtonElement>(null)
  const graph = useMemo(
    () =>
      layoutWorkflowGraph(workflow, {
        selectedNodeId,
        editable,
        ...(onAddAgent === undefined ? {} : { onAddAgent }),
        ...(addAgentDisabledReason === undefined ? {} : { addAgentDisabledReason }),
        ...(recentRunStatuses === undefined ? {} : { recentRunStatuses }),
      }),
    [addAgentDisabledReason, editable, onAddAgent, recentRunStatuses, selectedNodeId, workflow],
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

  const actionDisabledReason = addAgentDisabledReason ?? (runnable ? undefined : runDisabledReason)

  if (graph.nodes.length === 0) {
    return (
      <div
        className="workflow-graph relative grid h-full min-h-0 min-w-0 place-items-center overflow-hidden bg-background"
        role="region"
        aria-label="Workflow graph"
      >
        {onRun === undefined && onConfigure === undefined ? null : (
          <div className="absolute top-3 right-3 z-10 grid justify-items-end gap-2">
            <div className="flex items-center gap-2">
              {onConfigure === undefined ? null : (
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Configure workflow"
                  onClick={onConfigure}
                >
                  <Settings2Icon aria-hidden="true" />
                </Button>
              )}
              {onRun === undefined ? null : (
                <Button
                  size="icon-sm"
                  aria-label="Run"
                  aria-describedby={actionDisabledReason ? 'workflow-action-status' : undefined}
                  className={runActionClassName}
                  disabled
                  title={runDisabledReason ?? 'Add an agent before starting a run.'}
                >
                  <RunActionContent />
                </Button>
              )}
            </div>
            {actionDisabledReason === undefined ? null : (
              <p
                id="workflow-action-status"
                role="status"
                aria-label="Workflow actions unavailable"
                className="max-w-80 rounded-md border border-border bg-card px-3 py-2 text-xs/4 text-muted-foreground shadow-[var(--shadow-raised)]"
              >
                {actionDisabledReason}
              </p>
            )}
          </div>
        )}
        <div className="max-w-sm px-6 text-center">
          <p className="text-sm/5 font-medium">No agents</p>
          <p className="mt-1 text-sm/5 text-muted-foreground">
            This workflow is empty and cannot be run yet.
          </p>
          {onAddAgent === undefined ? null : (
            <Button
              className="mt-4"
              aria-describedby={
                addAgentDisabledReason === undefined ? undefined : 'workflow-action-status'
              }
              disabled={addAgentDisabledReason !== undefined}
              title={addAgentDisabledReason}
              onClick={() => onAddAgent()}
            >
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
      {onRun === undefined && onConfigure === undefined ? null : (
        <div className="absolute top-3 right-3 z-10 grid justify-items-end gap-2">
          <div className="flex items-center gap-2">
            {onConfigure === undefined ? null : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      onClick={onConfigure}
                      size="icon-sm"
                      variant="outline"
                      aria-label="Configure workflow"
                    />
                  }
                >
                  <Settings2Icon aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end" sideOffset={6}>
                  Configure workflow
                </TooltipContent>
              </Tooltip>
            )}
            {onRun === undefined ? null : runnable ? (
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
                aria-describedby={actionDisabledReason ? 'workflow-action-status' : undefined}
                className={runActionClassName}
                disabled
                title={runDisabledReason ?? 'Connect every agent to make this workflow runnable.'}
              >
                <RunActionContent />
              </Button>
            )}
          </div>
          {actionDisabledReason === undefined ? null : (
            <p
              id="workflow-action-status"
              role="status"
              aria-label="Workflow actions unavailable"
              className="max-w-80 rounded-md border border-border bg-card px-3 py-2 text-xs/4 text-muted-foreground shadow-[var(--shadow-raised)]"
            >
              {actionDisabledReason}
            </p>
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
