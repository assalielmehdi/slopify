import type { AgentNode, NodeExecutionStatus } from '@slopify/shared'

import { ElapsedTime } from '@/components/runs/elapsed-time'
import { RunNodePanel } from '@/components/runs/run-node-panel'
import type { NodeExecutionSnapshot } from '@/components/runs/run-node-panel'
import { NodeStatusBadge } from '@/components/runs/run-status'
import { formatDuration, formatTimestamp } from '@/lib/run-format'

interface RunNodeDetailsPanelProps {
  readonly execution: NodeExecutionSnapshot | undefined
  readonly node: AgentNode
  readonly status: NodeExecutionStatus
}

export function RunNodeDetailsPanel({ execution, node, status }: RunNodeDetailsPanelProps) {
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
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h2
            className="min-w-0 text-[18px]/6 font-semibold tracking-[-0.01em]"
            id="run-node-panel-title"
          >
            {node.name}
          </h2>
          <NodeStatusBadge status={status} />
        </div>
        <div
          aria-label="Execution timing"
          className="mt-2 flex flex-col overflow-x-auto text-xs/4 whitespace-nowrap text-muted-foreground tabular-nums"
        >
          <span>Started {formatTimestamp(execution?.startedAt ?? null)}</span>
          <span>
            {status === 'RUNNING' ? (
              <>
                Working for{' '}
                <ElapsedTime
                  completedAt={execution?.completedAt ?? null}
                  running
                  startedAt={execution?.startedAt ?? null}
                />
              </>
            ) : (
              <>
                Worked for {durationMs === undefined ? 'Not recorded' : formatDuration(durationMs)}
              </>
            )}
          </span>
        </div>
      </header>
      <RunNodePanel execution={execution} node={node} status={status} />
    </aside>
  )
}
