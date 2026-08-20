import type { NodeExecutionStatus } from '@loop/contracts'
import type { WorkflowNode as DomainWorkflowNode } from '@loop/workflow-model'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { BotIcon, FlagIcon, RouteIcon, SquareTerminalIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface WorkflowNodeData extends Record<string, unknown> {
  readonly domainNode: DomainWorkflowNode
  readonly isStart: boolean
  readonly isTerminal: boolean
  readonly recentRunStatus?: NodeExecutionStatus
}

export type WorkflowCanvasNode = Node<WorkflowNodeData, 'workflow'>

const nodeKind = {
  agent: { Icon: BotIcon, label: 'Agent' },
  command: { Icon: SquareTerminalIcon, label: 'Command' },
  router: { Icon: RouteIcon, label: 'Router' },
  terminal: { Icon: FlagIcon, label: 'Terminal' },
} as const

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
  const { Icon, label } = nodeKind[domainNode.type]

  return (
    <article
      className={cn(
        'flex h-32 w-56 flex-col gap-3 border bg-card p-3 text-card-foreground shadow-sm',
        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
      )}
      data-selected={selected || undefined}
    >
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="outline">
          <Icon aria-hidden="true" data-icon="inline-start" />
          {label}
        </Badge>
        {data.isStart ? <Badge variant="secondary">Start</Badge> : null}
        {domainNode.type === 'terminal' ? (
          <Badge variant={domainNode.terminalStatus === 'FAILED' ? 'destructive' : 'secondary'}>
            {statusLabels[domainNode.terminalStatus]}
          </Badge>
        ) : null}
        {data.recentRunStatus === undefined ? null : (
          <Badge variant="secondary">{statusLabels[data.recentRunStatus]}</Badge>
        )}
        {selected ? <Badge>Selected</Badge> : null}
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm/5 font-medium">{domainNode.name}</h3>
        <p className="truncate font-mono text-xs/4 text-muted-foreground">{domainNode.id}</p>
      </div>
    </article>
  )
}

export function WorkflowNode({ data, selected }: NodeProps<WorkflowCanvasNode>) {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <WorkflowNodeContent data={data} selected={selected} />
      {data.isTerminal ? null : (
        <Handle type="source" position={Position.Bottom} isConnectable={false} />
      )}
    </>
  )
}
