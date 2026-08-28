import type { AgentTrace, NodeExecutionStatus } from '@slopify/contracts'
import type { AgentNode } from '@slopify/workflow-model'

import { RunNodePanel, type RunNodePanelProps } from '@/components/runs/run-node-panel'
import { NodeStatusBadge } from '@/components/runs/run-status'
import type { NodeExecution } from '@/lib/live-run'
import { formatDuration, formatTimestamp } from '@/lib/run-format'

interface RunNodeDetailsPanelProps {
  readonly repositories?: RunNodePanelProps['repositories']
  readonly repositoryWorkspaces?: RunNodePanelProps['repositoryWorkspaces']
  readonly execution: NodeExecution | undefined
  readonly node: AgentNode
  readonly status: NodeExecutionStatus
  readonly trace: AgentTrace | undefined
  readonly traceError: string | undefined
  readonly traceLoading: boolean
}

export function RunNodeDetailsPanel({
  execution,
  node,
  repositories,
  repositoryWorkspaces,
  status,
  trace,
  traceError,
  traceLoading,
}: RunNodeDetailsPanelProps) {
  const durationMs =
    execution?.durationMs ??
    (execution?.startedAt === null ||
    execution?.startedAt === undefined ||
    execution.completedAt === null
      ? undefined
      : Math.max(0, Date.parse(execution.completedAt) - Date.parse(execution.startedAt)))

  return (
    <aside
      aria-labelledby="run-node-panel-title"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
      data-layout="workspace"
    >
      <header className="relative shrink-0 border-b border-border p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[18px]/6 font-semibold tracking-[-0.01em]" id="run-node-panel-title">
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
    </aside>
  )
}
