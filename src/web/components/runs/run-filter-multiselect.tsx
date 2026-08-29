'use client'

import { CheckIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface RunFilterMultiSelectOption<Id extends string = string> {
  readonly id: Id
  readonly label: string
  readonly description?: string | undefined
}

export function RunFilterMultiSelect<Id extends string>({
  ariaLabel,
  emptyLabel,
  failed,
  loading,
  onToggle,
  options,
  selectedIds,
}: Readonly<{
  ariaLabel: string
  emptyLabel: string
  failed: boolean
  loading: boolean
  onToggle: (id: Id, selected: boolean) => void
  options: readonly RunFilterMultiSelectOption<Id>[]
  selectedIds: ReadonlySet<Id>
}>) {
  if (loading) {
    return <p className="px-2 py-8 text-center text-sm text-muted-foreground">Loading…</p>
  }
  if (failed) {
    return (
      <p className="px-2 py-8 text-center text-sm text-muted-foreground">
        Filter options are unavailable.
      </p>
    )
  }
  if (options.length === 0) {
    return <p className="px-2 py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <div aria-label={ariaLabel} className="max-h-64 space-y-0.5 overflow-y-auto" role="group">
      {options.map((option) => {
        const selected = selectedIds.has(option.id)
        const accessibleName =
          option.description === undefined ? option.label : `${option.label}, ${option.description}`
        return (
          <Button
            aria-checked={selected}
            aria-label={accessibleName}
            className="h-auto min-h-10 w-full justify-start gap-2 px-2 py-1.5 text-left"
            key={option.id}
            onClick={() => onToggle(option.id, selected)}
            role="checkbox"
            variant="ghost"
          >
            <CheckIcon
              aria-hidden="true"
              className={cn('size-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm/5">{option.label}</span>
              {option.description === undefined ? null : (
                <span className="block truncate font-mono text-xs/4 text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
          </Button>
        )
      })}
    </div>
  )
}
