'use client'

import type { LucideIcon } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

export interface SegmentedControlOption {
  readonly icon?: LucideIcon
  readonly label: string
  readonly value: string
}

export function SegmentedControl({
  ariaLabel,
  ariaLabelledBy,
  className,
  indicatorTestId,
  onValueChange,
  options,
  value,
}: Readonly<{
  ariaLabel?: string
  ariaLabelledBy?: string
  className?: string
  indicatorTestId?: string
  onValueChange: (value: string) => void
  options: readonly SegmentedControlOption[]
  value: string
}>) {
  const controlRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const hasPositionedIndicator = useRef(false)

  useLayoutEffect(() => {
    const control = controlRef.current
    const indicator = indicatorRef.current
    if (!control || !indicator) return

    const positionIndicator = (animate: boolean) => {
      const selectedOption = control.querySelector<HTMLElement>(`[data-option="${value}"]`)
      if (!selectedOption) return

      if (!animate) indicator.style.transition = 'none'
      indicator.style.transform = `translateX(${selectedOption.offsetLeft}px)`
      indicator.style.width = `${selectedOption.offsetWidth}px`
      if (!animate) {
        void indicator.offsetWidth
        indicator.style.transition = ''
      }
    }

    positionIndicator(hasPositionedIndicator.current)
    hasPositionedIndicator.current = true
    const handleResize = () => positionIndicator(false)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [value])

  return (
    <div
      ref={controlRef}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn('t-tabs navigation-theme-tabs', className)}
    >
      <span
        ref={indicatorRef}
        data-testid={indicatorTestId}
        aria-hidden="true"
        className="t-tabs-pill"
      />
      {options.map(({ icon: Icon, label, value: optionValue }, optionIndex) => (
        <button
          key={optionValue}
          type="button"
          role="radio"
          aria-label={Icon === undefined ? undefined : label}
          aria-checked={value === optionValue}
          tabIndex={value === optionValue ? 0 : -1}
          title={Icon === undefined ? undefined : label}
          data-option={optionValue}
          className={cn(
            't-tab',
            Icon === undefined
              ? 'min-w-0 flex-1 sm:min-w-20'
              : 'flex w-8 items-center justify-center p-0',
          )}
          onClick={() => onValueChange(optionValue)}
          onKeyDown={(event) => {
            let nextIndex = optionIndex
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              nextIndex = (optionIndex + 1) % options.length
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              nextIndex = (optionIndex - 1 + options.length) % options.length
            } else if (event.key === 'Home') {
              nextIndex = 0
            } else if (event.key === 'End') {
              nextIndex = options.length - 1
            } else {
              return
            }

            event.preventDefault()
            const nextOption = options[nextIndex]?.value
            if (!nextOption) return
            onValueChange(nextOption)
            controlRef.current?.querySelector<HTMLElement>(`[data-option="${nextOption}"]`)?.focus()
          }}
        >
          {Icon === undefined ? (
            label
          ) : (
            <Icon aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
          )}
        </button>
      ))}
    </div>
  )
}
