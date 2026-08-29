import type { NodeExecutionStatus, RunStatus } from '@slopify/shared'
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
  CORRUPT: { label: 'Corrupt', variant: 'destructive' },
} as const satisfies Readonly<
  Record<
    RunStatus | 'CORRUPT',
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

export function RunStatusBadge({ status }: Readonly<{ status: RunStatus | 'CORRUPT' }>) {
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
