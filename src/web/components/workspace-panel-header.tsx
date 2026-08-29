import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export function WorkspacePanelHeader({
  action,
  icon: Icon,
  subtitle,
  title,
}: Readonly<{
  action?: ReactNode | undefined
  icon: LucideIcon
  subtitle: string
  title: string
}>) {
  return (
    <header
      className={cn(
        'relative shrink-0 border-b border-border p-6',
        action === undefined ? null : 'pr-14',
      )}
      data-slot="workspace-panel-header"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[18px]/6 font-semibold tracking-[-0.01em]">{title}</h2>
          <p className="text-xs/4 text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {action}
    </header>
  )
}
