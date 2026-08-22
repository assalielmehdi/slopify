import type { NodeExecutionStatus } from '@slopify/contracts'
import type { AgentNode } from '@slopify/workflow-model'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { BotIcon, PlusIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface WorkflowNodeData extends Record<string, unknown> {
  readonly domainNode: AgentNode
  readonly isStart: boolean
  readonly isEnd: boolean
  readonly recentRunStatus?: NodeExecutionStatus
  readonly onAddAgent?: (() => void) | undefined
}

export type WorkflowCanvasNode = Node<WorkflowNodeData, 'workflow'>

const statusLabels: Readonly<Record<NodeExecutionStatus, string>> = {
  PENDING: 'Pending',
  RUNNING: 'Running',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  SKIPPED: 'Skipped',
}

export function WorkflowNodeContent({
  data,
  selected,
}: Readonly<{ data: WorkflowNodeData; selected: boolean }>) {
  const { domainNode } = data
  const status = data.recentRunStatus

  return (
    <article
      className={cn(
        'flex h-30 w-54 flex-col gap-3 rounded-lg border bg-card p-3.5 text-card-foreground shadow-[var(--shadow-raised)] transition-[border-color,box-shadow,transform] duration-[var(--duration-quick)] hover:shadow-[var(--shadow-raised-hover)]',
        status === 'RUNNING' && 'border-status-info/35 bg-status-info/10',
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
    </article>
  )
}

export function WorkflowNode({ data, selected, isConnectable }: NodeProps<WorkflowCanvasNode>) {
  return (
    <div className="group/node relative">
      {data.isStart ? null : (
        <Handle
          type="target"
          position={Position.Top}
          isConnectable={isConnectable}
          aria-label={`Connect into ${data.domainNode.name}`}
        />
      )}
      <WorkflowNodeContent data={data} selected={selected} />
      {data.isEnd ? null : (
        <Handle
          type="source"
          position={Position.Bottom}
          isConnectable={isConnectable}
          aria-label={`Connect from ${data.domainNode.name}`}
        />
      )}
      {data.onAddAgent === undefined ? null : (
        <Button
          type="button"
          size="icon-xs"
          variant="outline"
          aria-label={`Add agent after ${data.domainNode.name}`}
          title={`Add agent after ${data.domainNode.name}`}
          className={cn(
            'nodrag nopan absolute top-full left-1/2 z-10 mt-2 translate-x-3 bg-background opacity-0 shadow-[var(--shadow-raised)] transition-[opacity,background-color,box-shadow,transform] group-hover/node:opacity-100 group-focus-within/node:opacity-100 hover:shadow-[var(--shadow-raised-hover)]',
            selected && 'opacity-100',
          )}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            data.onAddAgent?.()
          }}
        >
          <PlusIcon aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}
