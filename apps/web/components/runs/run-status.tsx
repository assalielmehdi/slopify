import type { NodeExecutionStatus, RunStatus } from '@slopify/contracts'
import type { ComponentProps } from 'react'

import { Badge } from '@/components/ui/badge'

const statusSuccessClassName = 'bg-status-success/10 text-status-success'
const statusInfoClassName = 'bg-status-info/10 text-status-info'
const statusWarningClassName = 'bg-status-warning/10 text-status-warning'
const statusNeutralClassName = 'bg-muted text-muted-foreground'

const runStatusPresentation = {
  PENDING: { label: 'Pending', variant: 'outline', className: statusNeutralClassName },
  RUNNING: { label: 'Running', variant: 'outline', className: statusInfoClassName },
  SUCCEEDED: { label: 'Succeeded', variant: 'outline', className: statusSuccessClassName },
  FAILED: { label: 'Failed', variant: 'destructive' },
  CANCELLED: { label: 'Cancelled', variant: 'outline', className: statusWarningClassName },
  INTERRUPTED: { label: 'Interrupted', variant: 'destructive' },
} as const satisfies Readonly<
  Record<
    RunStatus,
    {
      readonly className?: string
      readonly label: string
      readonly variant: ComponentProps<typeof Badge>['variant']
    }
  >
>

const nodeStatusPresentation = {
  PENDING: { label: 'Pending', variant: 'outline' },
  RUNNING: { label: 'Running', variant: 'outline', className: statusInfoClassName },
  SUCCEEDED: { label: 'Succeeded', variant: 'outline', className: statusSuccessClassName },
  FAILED: { label: 'Failed', variant: 'destructive' },
  CANCELLED: { label: 'Cancelled', variant: 'outline' },
  SKIPPED: { label: 'Skipped', variant: 'outline' },
} as const satisfies Readonly<
  Record<
    NodeExecutionStatus,
    {
      readonly className?: string
      readonly label: string
      readonly variant: ComponentProps<typeof Badge>['variant']
    }
  >
>

export function RunStatusBadge({ status }: Readonly<{ status: RunStatus }>) {
  const presentation = runStatusPresentation[status]
  return (
    <Badge
      className={'className' in presentation ? presentation.className : undefined}
      variant={presentation.variant}
    >
      {presentation.label}
    </Badge>
  )
}

export function NodeStatusBadge({ status }: Readonly<{ status: NodeExecutionStatus }>) {
  const presentation = nodeStatusPresentation[status]
  return (
    <Badge
      className={'className' in presentation ? presentation.className : undefined}
      variant={presentation.variant}
    >
      {presentation.label}
    </Badge>
  )
}

export const formatDuration = (durationMs: number): string => {
  if (durationMs < 1_000) return `${durationMs} ms`
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.floor((durationMs % 60_000) / 1_000)
  return `${minutes}m ${seconds}s`
}

export const formatTimestamp = (timestamp: string | null): string =>
  timestamp === null
    ? 'Not recorded'
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(new Date(timestamp))
