import type { NodeExecutionStatus } from '@slopify/contracts'
import type { AgentNode } from '@slopify/workflow-model'
import { BotIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface WorkflowNodeData extends Record<string, unknown> {
  readonly domainNode: AgentNode
  readonly isStart: boolean
  readonly isEnd: boolean
  readonly recentRunStatus?: NodeExecutionStatus
}

const statusLabels: Readonly<Record<NodeExecutionStatus, string>> = {
  PENDING: 'Pending',
  RUNNING: 'Running',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
}

export function WorkflowNodeContent({
  data,
  selected,
}: Readonly<{ data: WorkflowNodeData; selected: boolean }>) {
  const { domainNode } = data
  const status = data.recentRunStatus

  return (
    <div
      className={cn(
        'relative isolate flex h-30 w-54 flex-col gap-3 overflow-hidden rounded-lg border bg-card p-3.5 text-card-foreground shadow-[var(--shadow-raised)] transition-[border-color,box-shadow,transform] duration-[var(--duration-quick)] hover:shadow-[var(--shadow-raised-hover)]',
        status === 'RUNNING' && 'workflow-node-running-fill border-status-info/35',
        status === 'SUCCEEDED' && 'border-status-success/35 bg-status-success/10',
        status === 'FAILED' && 'border-destructive/35 bg-destructive/10',
        status === 'CANCELLED' && 'border-status-warning/35 bg-status-warning/10',
        selected && 'border-foreground/30 ring-2 ring-foreground/10',
      )}
      data-selected={selected || undefined}
      data-status={status}
    >
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="outline">
          <BotIcon aria-hidden="true" data-icon="inline-start" />
          Agent
        </Badge>
        {data.isStart ? <Badge variant="secondary">Start</Badge> : null}
        {data.isEnd ? <Badge variant="secondary">End</Badge> : null}
        {status === undefined ? null : <Badge variant="outline">{statusLabels[status]}</Badge>}
        {selected ? <Badge>Selected</Badge> : null}
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm/5 font-semibold tracking-[-0.01em]">{domainNode.name}</h3>
        <p className="truncate font-mono text-xs/4 text-muted-foreground">{domainNode.id}</p>
      </div>
    </div>
  )
}
