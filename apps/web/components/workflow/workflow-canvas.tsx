'use client'

import type { NodeExecutionStatus } from '@slopify/contracts'
import type { Workflow } from '@slopify/workflow-model'
import { PlayIcon, Settings2Icon } from 'lucide-react'
import { useEffect, useId, useMemo, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  layoutWorkflowGraph,
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
  type WorkflowGraphEdge,
} from '@/lib/workflow-graph-layout'

import { WorkflowNodeContent } from './workflow-node'

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

function edgePath(edge: WorkflowGraphEdge) {
  return edge.points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
}

function edgeMidpoint(edge: WorkflowGraphEdge) {
  return edge.points[Math.floor(edge.points.length / 2)]
}

export interface WorkflowCanvasProps {
  readonly workflow: Workflow
  readonly selectedNodeId?: string | null | undefined
  readonly onNodeSelect: (nodeId: string) => void
  readonly recentRunStatuses?: Readonly<Record<string, NodeExecutionStatus>>
  readonly onRun?: (() => void) | undefined
  readonly onConfigure?: (() => void) | undefined
  readonly runnable?: boolean | undefined
  readonly runDisabledReason?: string | undefined
}

export function WorkflowCanvas({
  workflow,
  selectedNodeId,
  onNodeSelect,
  recentRunStatuses,
  onRun,
  onConfigure,
  runnable = false,
  runDisabledReason,
}: WorkflowCanvasProps) {
  const runButtonRef = useRef<HTMLButtonElement>(null)
  const markerId = `workflow-arrow-${useId().replaceAll(':', '')}`
  const graph = useMemo(
    () =>
      layoutWorkflowGraph(workflow, {
        ...(recentRunStatuses === undefined ? {} : { recentRunStatuses }),
      }),
    [recentRunStatuses, workflow],
  )
  const nodeNames = useMemo(
    () => new Map<string, string>(workflow.nodes.map(({ id, name }) => [id, name])),
    [workflow.nodes],
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

  const actions =
    onRun === undefined && onConfigure === undefined ? null : (
      <div className="absolute top-3 right-3 z-20 grid justify-items-end gap-2">
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
              aria-describedby={runDisabledReason ? 'workflow-action-status' : undefined}
              className={runActionClassName}
              disabled
              title={runDisabledReason ?? 'Define at least one agent before starting a run.'}
            >
              <RunActionContent />
            </Button>
          )}
        </div>
        {runDisabledReason === undefined ? null : (
          <p
            id="workflow-action-status"
            role="status"
            aria-label="Workflow actions unavailable"
            className="max-w-80 rounded-md border border-border bg-card px-3 py-2 text-xs/4 text-muted-foreground shadow-[var(--shadow-raised)]"
          >
            {runDisabledReason}
          </p>
        )}
      </div>
    )

  if (graph.nodes.length === 0) {
    return (
      <div
        className="workflow-graph relative grid h-full min-h-0 min-w-0 place-items-center overflow-hidden bg-background"
        role="region"
        aria-label="Workflow graph"
      >
        {actions}
        <div className="max-w-sm px-6 text-center">
          <p className="text-sm/5 font-medium">No agents</p>
          <p className="mt-1 text-sm/5 text-muted-foreground">
            Define the graph JSON in workflow configuration before starting a run.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="workflow-graph relative h-full min-h-0 min-w-0 overflow-auto bg-background"
      role="region"
      aria-label="Workflow graph"
    >
      {actions}
      <div className="grid min-h-full min-w-full place-items-center p-8">
        <div className="relative" style={{ height: graph.height, width: graph.width }}>
          <svg
            aria-hidden="true"
            className="absolute inset-0 overflow-visible text-muted-foreground"
            height={graph.height}
            width={graph.width}
          >
            <defs>
              <marker
                id={markerId}
                markerHeight="7"
                markerWidth="7"
                orient="auto-start-reverse"
                refX="6"
                refY="3.5"
              >
                <path d="M 0 0 L 7 3.5 L 0 7 z" fill="currentColor" />
              </marker>
            </defs>
            {graph.edges.map((edge) => {
              const midpoint = edgeMidpoint(edge)
              return (
                <g key={edge.id}>
                  <path
                    d={edgePath(edge)}
                    fill="none"
                    markerEnd={`url(#${markerId})`}
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  {midpoint === undefined ? null : (
                    <text
                      className="fill-muted-foreground text-[11px]"
                      textAnchor="middle"
                      x={midpoint.x + 8}
                      y={midpoint.y - 8}
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>

          {graph.nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              aria-label={node.ariaLabel}
              aria-pressed={node.id === selectedNodeId}
              className="absolute rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => onNodeSelect(node.id)}
              style={{
                height: WORKFLOW_NODE_HEIGHT,
                left: node.position.x,
                top: node.position.y,
                width: WORKFLOW_NODE_WIDTH,
              }}
            >
              <WorkflowNodeContent data={node.data} selected={node.id === selectedNodeId} />
            </button>
          ))}
        </div>
      </div>

      <ol className="sr-only" aria-label="Workflow transitions">
        {graph.edges.map((edge) => (
          <li key={edge.id}>
            {nodeNames.get(edge.sourceNodeId) ?? edge.sourceNodeId} to{' '}
            {nodeNames.get(edge.targetNodeId) ?? edge.targetNodeId}: {edge.label} ({edge.outcome})
          </li>
        ))}
      </ol>
    </div>
  )
}
