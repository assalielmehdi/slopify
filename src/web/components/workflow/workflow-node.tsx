import type { NodeExecutionStatus } from '@slopify/shared'
import type { AgentNode } from '@slopify/shared'
import { BotIcon } from 'lucide-react'
import Image from 'next/image'

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

const harnessLogos = {
  codex: { alt: 'Codex harness', src: '/codex-logo.svg' },
  pi: { alt: 'Pi harness', src: '/pi-badge.svg' },
} as const

function HarnessLogo({ harnessId }: Readonly<{ harnessId: string }>) {
  const logo = harnessLogos[harnessId as keyof typeof harnessLogos]

  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center"
      data-runtime-field="harness"
      title={`Harness: ${harnessId}`}
    >
      {logo === undefined ? (
        <BotIcon aria-label={`${harnessId} harness`} className="size-4" role="img" />
      ) : (
        <Image alt={logo.alt} className="size-4 rounded-sm" height={16} src={logo.src} width={16} />
      )}
    </span>
  )
}

export function WorkflowNodeContent({
  data,
  selected,
}: Readonly<{ data: WorkflowNodeData; selected: boolean }>) {
  const { domainNode } = data
  const status = data.recentRunStatus
  const modelLabel = domainNode.harness.modelId ?? 'Default model'
  const thinkingLabel = domainNode.harness.thinkingLevel ?? 'Default effort'

  return (
    <div
      className={cn(
        'relative isolate flex h-36 w-54 flex-col gap-2 overflow-hidden rounded-lg border p-3.5 text-card-foreground shadow-[var(--shadow-raised)] transition-[border-color,box-shadow,transform] duration-[var(--duration-quick)] hover:shadow-[var(--shadow-raised-hover)]',
        status !== 'SUCCEEDED' && 'bg-muted/55',
        status === 'RUNNING' && 'workflow-node-running-fill border-status-info/35',
        status === 'SUCCEEDED' && 'border-status-success/35 bg-status-success/10',
        status === 'FAILED' && 'border-destructive/35',
        status === 'CANCELLED' && 'border-status-warning/35',
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
      <div className="mt-auto flex min-w-0 items-center justify-end gap-1" data-node-runtime="">
        <HarnessLogo harnessId={domainNode.harness.harnessId} />
        <Badge
          aria-label={`Model: ${modelLabel}`}
          className="min-w-0 max-w-24 shrink px-1.5 font-mono font-normal"
          data-runtime-field="model"
          title={`Model: ${modelLabel}`}
          variant="secondary"
        >
          <span className="truncate">{modelLabel}</span>
        </Badge>
        <Badge
          aria-label={`Thinking effort: ${thinkingLabel}`}
          className="min-w-0 max-w-20 shrink px-1.5 font-mono font-normal"
          data-runtime-field="thinking"
          title={`Thinking effort: ${thinkingLabel}`}
          variant="secondary"
        >
          <span className="truncate">{thinkingLabel}</span>
        </Badge>
      </div>
    </div>
  )
}
