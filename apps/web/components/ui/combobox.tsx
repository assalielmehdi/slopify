'use client'

import * as React from 'react'
import { Combobox as ComboboxPrimitive } from '@base-ui/react'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

const Combobox = ComboboxPrimitive.Root

function ComboboxInput({ className, disabled = false, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <div
      className={cn(
        'flex h-9 w-full items-center rounded-md border border-input bg-card transition-[color,background-color,border-color] duration-[var(--duration-quick)] focus-within:border-ring has-disabled:cursor-not-allowed has-disabled:bg-muted has-disabled:opacity-60 dark:bg-input/20 dark:has-disabled:bg-input/50',
        className,
      )}
      data-slot="combobox-control"
    >
      <ComboboxPrimitive.Input
        className="min-w-0 flex-1 bg-transparent py-1.5 pr-1 pl-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        data-slot="combobox-input"
        disabled={disabled}
        {...props}
      />
      <ComboboxPrimitive.Trigger
        aria-label="Toggle options"
        className="flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
        data-slot="combobox-trigger"
        disabled={disabled}
      >
        <ChevronDownIcon aria-hidden="true" className="size-4" />
      </ComboboxPrimitive.Trigger>
    </div>
  )
}

function ComboboxContent({
  align = 'start',
  alignOffset = 0,
  children,
  className,
  side = 'bottom',
  sideOffset = 4,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<ComboboxPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <ComboboxPrimitive.Popup
          className={cn(
            'relative max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-hidden rounded-md bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-[var(--duration-quick)] data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
            className,
          )}
          data-slot="combobox-content"
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      className={cn('max-h-72 scroll-py-1 overflow-y-auto overscroll-contain', className)}
      data-slot="combobox-list"
      {...props}
    />
  )
}

function ComboboxItem({ children, className, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-sm py-2 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      data-slot="combobox-item"
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon aria-hidden="true" className="size-4" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      className={cn('py-6 text-center text-sm text-muted-foreground', className)}
      data-slot="combobox-empty"
      {...props}
    />
  )
}

export { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList }
