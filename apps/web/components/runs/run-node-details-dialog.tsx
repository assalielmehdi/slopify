'use client'

import { XIcon } from 'lucide-react'
import { useEffect, useRef, type CSSProperties } from 'react'

import type { AgentTrace, NodeExecutionStatus } from '@slopify/contracts'
import type { AgentNode } from '@slopify/workflow-model'

import { RunNodePanel, type RunNodePanelProps } from '@/components/runs/run-node-panel'
import { NodeStatusBadge } from '@/components/runs/run-status'
import { Button } from '@/components/ui/button'
import type { NodeExecution } from '@/lib/live-run'
import { formatDuration, formatTimestamp } from '@/lib/run-format'

interface RunNodeDetailsDialogProps {
  readonly repositories?: RunNodePanelProps['repositories']
  readonly repositoryWorkspaces?: RunNodePanelProps['repositoryWorkspaces']
  readonly execution: NodeExecution | undefined
  readonly isOpen: boolean
  readonly node: AgentNode
  readonly onClose: () => void
  readonly onExited: () => void
  readonly status: NodeExecutionStatus
  readonly trace: AgentTrace | undefined
  readonly traceError: string | undefined
  readonly traceLoading: boolean
}

export function RunNodeDetailsDialog({
  execution,
  isOpen,
  node,
  onClose,
  onExited,
  repositories,
  repositoryWorkspaces,
  status,
  trace,
  traceError,
  traceLoading,
}: RunNodeDetailsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.show === 'function') dialog.show()
      else dialog.setAttribute('open', '')
    }
    return () => {
      if (!dialog?.open) return
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [])

  const durationMs =
    execution?.durationMs ??
    (execution?.startedAt === null ||
    execution?.startedAt === undefined ||
    execution.completedAt === null
      ? undefined
      : Math.max(0, Date.parse(execution.completedAt) - Date.parse(execution.startedAt)))

  return (
    <div
      className="floating-panel-shell absolute inset-y-3 right-3 z-30 w-[min(34rem,calc(100%-1.5rem))]"
      data-open={isOpen}
      data-testid="run-node-panel-shell"
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'translate' && !isOpen) {
          onExited()
        }
      }}
      style={
        {
          '--panel-open-dur': '350ms',
          '--panel-close-dur': '350ms',
          '--panel-translate-y': '0px',
        } as CSSProperties
      }
    >
      <dialog
        ref={dialogRef}
        aria-labelledby="run-node-panel-title"
        aria-modal="false"
        className="t-panel-slide relative m-0 flex h-full max-h-none w-full max-w-none flex-col overflow-hidden rounded-xl border border-border bg-card p-0 text-card-foreground shadow-[var(--shadow-overlay)]"
        data-layout="floating"
        data-open={isOpen}
      >
        <header className="relative shrink-0 border-b border-border p-6 pr-14">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              className="text-[18px]/6 font-semibold tracking-[-0.01em]"
              id="run-node-panel-title"
            >
              {node.name}
            </h2>
            <NodeStatusBadge status={status} />
          </div>
          <div
            aria-label="Execution summary"
            className="mt-2 overflow-x-auto text-xs/4 whitespace-nowrap text-muted-foreground tabular-nums"
          >
            Started {formatTimestamp(execution?.startedAt ?? null)} - Took{' '}
            {durationMs === undefined ? 'Not recorded' : formatDuration(durationMs)}
          </div>
          <Button
            aria-label="Close agent details"
            className="absolute top-3 right-3 size-10 sm:size-9"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </header>
        <RunNodePanel
          execution={execution}
          node={node}
          {...(repositories === undefined ? {} : { repositories })}
          {...(repositoryWorkspaces === undefined ? {} : { repositoryWorkspaces })}
          status={status}
          trace={trace}
          traceError={traceError}
          traceLoading={traceLoading}
        />
      </dialog>
    </div>
  )
}
