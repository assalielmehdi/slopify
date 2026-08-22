'use client'

import type { RunStatus } from '@slopify/contracts'
import {
  ActivityIcon,
  ArrowLeftIcon,
  CalendarIcon,
  CalendarClockIcon,
  CheckIcon,
  ChevronRightIcon,
  Clock3Icon,
  FingerprintIcon,
  ListFilterIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import { type ComponentProps, useMemo, useState } from 'react'
import { format } from 'date-fns'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface RunFilters {
  readonly runId: string
  readonly statuses: readonly RunStatus[]
  readonly startedFrom: string
  readonly startedTo: string
  readonly durationMinSeconds: string
  readonly durationMaxSeconds: string
}

export const emptyRunFilters: RunFilters = {
  runId: '',
  statuses: [],
  startedFrom: '',
  startedTo: '',
  durationMinSeconds: '',
  durationMaxSeconds: '',
}

type AttributeKey = 'runId' | 'started' | 'duration' | 'status'

const statuses: readonly RunStatus[] = [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
]

const statusFilterClassName = {
  PENDING:
    'text-muted-foreground hover:bg-muted/70 hover:text-muted-foreground aria-checked:bg-muted aria-checked:text-muted-foreground',
  RUNNING:
    'text-status-info hover:bg-status-info/10 hover:text-status-info aria-checked:bg-status-info/15 aria-checked:text-status-info dark:hover:bg-status-info/15 dark:aria-checked:bg-status-info/20',
  SUCCEEDED:
    'text-status-success hover:bg-status-success/10 hover:text-status-success aria-checked:bg-status-success/15 aria-checked:text-status-success dark:hover:bg-status-success/15 dark:aria-checked:bg-status-success/20',
  FAILED:
    'text-destructive hover:bg-destructive/10 hover:text-destructive aria-checked:bg-destructive/15 aria-checked:text-destructive dark:hover:bg-destructive/15 dark:aria-checked:bg-destructive/20',
  CANCELLED:
    'text-status-warning hover:bg-status-warning/10 hover:text-status-warning aria-checked:bg-status-warning/15 aria-checked:text-status-warning dark:hover:bg-status-warning/15 dark:aria-checked:bg-status-warning/20',
  INTERRUPTED:
    'text-destructive hover:bg-destructive/10 hover:text-destructive aria-checked:bg-destructive/15 aria-checked:text-destructive dark:hover:bg-destructive/15 dark:aria-checked:bg-destructive/20',
} as const satisfies Readonly<Record<RunStatus, string>>

const statusLabel = (status: RunStatus): string => status.charAt(0) + status.slice(1).toLowerCase()

const valueCount = (attribute: AttributeKey, filters: RunFilters): number => {
  if (attribute === 'runId') return filters.runId.trim() === '' ? 0 : 1
  if (attribute === 'status') return filters.statuses.length
  if (attribute === 'started')
    return Number(filters.startedFrom !== '') + Number(filters.startedTo !== '')
  return Number(filters.durationMinSeconds !== '') + Number(filters.durationMaxSeconds !== '')
}

export const activeRunFilterCount = (filters: RunFilters): number =>
  (['runId', 'started', 'duration', 'status'] as const).filter(
    (attribute) => valueCount(attribute, filters) > 0,
  ).length

const attributes = [
  { key: 'runId', label: 'Run ID', icon: FingerprintIcon },
  { key: 'started', label: 'Started', icon: CalendarClockIcon },
  { key: 'duration', label: 'Duration', icon: Clock3Icon },
  { key: 'status', label: 'Status', icon: ActivityIcon },
] as const

const clearAttribute = (attribute: AttributeKey, filters: RunFilters): RunFilters => {
  if (attribute === 'runId') return { ...filters, runId: '' }
  if (attribute === 'status') return { ...filters, statuses: [] }
  if (attribute === 'started') return { ...filters, startedFrom: '', startedTo: '' }
  return { ...filters, durationMinSeconds: '', durationMaxSeconds: '' }
}

const filterSummary = (attribute: AttributeKey, filters: RunFilters): string => {
  if (attribute === 'runId') return `Run ID: ${filters.runId.trim()}`
  if (attribute === 'status') return `Status: ${filters.statuses.map(statusLabel).join(', ')}`
  if (attribute === 'started') {
    if (filters.startedFrom !== '' && filters.startedTo !== '')
      return `Started: ${filters.startedFrom} – ${filters.startedTo}`
    return `Started: ${filters.startedFrom || `through ${filters.startedTo}`}`
  }
  if (filters.durationMinSeconds !== '' && filters.durationMaxSeconds !== '')
    return `Duration: ${filters.durationMinSeconds}–${filters.durationMaxSeconds}s`
  return filters.durationMinSeconds !== ''
    ? `Duration: ≥ ${filters.durationMinSeconds}s`
    : `Duration: ≤ ${filters.durationMaxSeconds}s`
}

const parseDateValue = (value: string): Date | undefined => {
  if (value === '') return undefined
  const [year, month, day] = value.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return undefined
  return new Date(year, month - 1, day)
}

function DateFilterPicker({
  ariaLabel,
  calendarTestId,
  disabled,
  onChange,
  value,
}: Readonly<{
  ariaLabel: string
  calendarTestId: string
  disabled?: ComponentProps<typeof Calendar>['disabled']
  onChange: (value: string) => void
  value: string
}>) {
  const [open, setOpen] = useState(false)
  const selected = parseDateValue(value)

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-label={ariaLabel}
        render={
          <Button
            className="w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
            data-empty={selected === undefined}
            size="sm"
            variant="outline"
          >
            <CalendarIcon aria-hidden="true" />
            {selected === undefined ? 'Pick a date' : format(selected, 'PP')}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          data-testid={calendarTestId}
          mode="single"
          onSelect={(date) => {
            if (date === undefined) return
            onChange(format(date, 'yyyy-MM-dd'))
            setOpen(false)
          }}
          {...(disabled === undefined ? {} : { disabled })}
          {...(selected === undefined ? {} : { defaultMonth: selected, selected })}
        />
      </PopoverContent>
    </Popover>
  )
}

function AttributeEditor({
  attribute,
  filters,
  onBack,
  onChange,
}: Readonly<{
  attribute: AttributeKey
  filters: RunFilters
  onBack: () => void
  onChange: (filters: RunFilters) => void
}>) {
  const definition = attributes.find((candidate) => candidate.key === attribute)
  if (definition === undefined) return null
  const count = valueCount(attribute, filters)
  const startedFromDate = parseDateValue(filters.startedFrom)
  const startedToDate = parseDateValue(filters.startedTo)

  return (
    <>
      <div className="flex h-12 items-center gap-2 border-b px-3">
        <Button
          aria-label="Back to filter attributes"
          onClick={onBack}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
        <span className="flex-1 text-sm font-medium">{definition.label}</span>
        {count > 0 ? (
          <Button
            className="h-8 px-2 text-xs"
            onClick={() => onChange(clearAttribute(attribute, filters))}
            variant="ghost"
          >
            Clear
          </Button>
        ) : null}
      </div>
      <div className="space-y-3 p-3">
        {attribute === 'runId' ? (
          <Input
            aria-label="Run ID contains"
            autoFocus
            maxLength={128}
            onChange={(event) => onChange({ ...filters, runId: event.target.value })}
            placeholder="Enter all or part of a run ID"
            value={filters.runId}
          />
        ) : null}
        {attribute === 'started' ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2 text-xs font-medium">
              <span>From</span>
              <DateFilterPicker
                ariaLabel="Started from"
                calendarTestId="started-from-calendar"
                disabled={startedToDate === undefined ? undefined : { after: startedToDate }}
                onChange={(next) => {
                  if (filters.startedTo !== '' && next > filters.startedTo) return
                  onChange({ ...filters, startedFrom: next })
                }}
                value={filters.startedFrom}
              />
            </div>
            <div className="grid gap-2 text-xs font-medium">
              <span>Through</span>
              <DateFilterPicker
                ariaLabel="Started through"
                calendarTestId="started-through-calendar"
                disabled={startedFromDate === undefined ? undefined : { before: startedFromDate }}
                onChange={(next) => {
                  if (filters.startedFrom !== '' && next < filters.startedFrom) return
                  onChange({ ...filters, startedTo: next })
                }}
                value={filters.startedTo}
              />
            </div>
          </div>
        ) : null}
        {attribute === 'duration' ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-2 text-xs font-medium">
              <span>Minimum seconds</span>
              <Input
                aria-label="Minimum duration in seconds"
                min="0"
                onChange={(event) => {
                  const next = event.target.value
                  if (next !== '' && Number(next) < 0) return
                  if (
                    filters.durationMaxSeconds !== '' &&
                    next !== '' &&
                    Number(next) > Number(filters.durationMaxSeconds)
                  )
                    return
                  onChange({ ...filters, durationMinSeconds: next })
                }}
                step="0.1"
                type="number"
                value={filters.durationMinSeconds}
              />
            </label>
            <label className="grid gap-2 text-xs font-medium">
              <span>Maximum seconds</span>
              <Input
                aria-label="Maximum duration in seconds"
                min={filters.durationMinSeconds || '0'}
                onChange={(event) => {
                  const next = event.target.value
                  if (next !== '' && Number(next) < 0) return
                  if (
                    filters.durationMinSeconds !== '' &&
                    next !== '' &&
                    Number(next) < Number(filters.durationMinSeconds)
                  )
                    return
                  onChange({ ...filters, durationMaxSeconds: next })
                }}
                step="0.1"
                type="number"
                value={filters.durationMaxSeconds}
              />
            </label>
          </div>
        ) : null}
        {attribute === 'status' ? (
          <div className="grid grid-cols-2 gap-1" aria-label="Run statuses">
            {statuses.map((status) => {
              const selected = filters.statuses.includes(status)
              return (
                <Button
                  aria-checked={selected}
                  className={cn('justify-start', statusFilterClassName[status])}
                  key={status}
                  onClick={() =>
                    onChange({
                      ...filters,
                      statuses: selected
                        ? filters.statuses.filter((candidate) => candidate !== status)
                        : [...filters.statuses, status],
                    })
                  }
                  role="checkbox"
                  size="sm"
                  variant="ghost"
                >
                  <CheckIcon
                    aria-hidden="true"
                    className={cn('size-3.5', selected ? 'opacity-100' : 'opacity-0')}
                  />
                  <span>{statusLabel(status)}</span>
                </Button>
              )
            })}
          </div>
        ) : null}
      </div>
    </>
  )
}

export function RunFilterControls({
  filters,
  onChange,
  updating = false,
}: Readonly<{
  filters: RunFilters
  onChange: (filters: RunFilters) => void
  updating?: boolean
}>) {
  const [open, setOpen] = useState(false)
  const [activeAttribute, setActiveAttribute] = useState<AttributeKey | null>(null)
  const [attributeQuery, setAttributeQuery] = useState('')
  const activeCount = activeRunFilterCount(filters)
  const visibleAttributes = useMemo(() => {
    const query = attributeQuery.trim().toLocaleLowerCase()
    return query === ''
      ? attributes
      : attributes.filter((attribute) => attribute.label.toLocaleLowerCase().includes(query))
  }, [attributeQuery])

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {activeCount === 0
          ? null
          : attributes
              .filter((attribute) => valueCount(attribute.key, filters) > 0)
              .map((attribute) => (
                <div
                  className="group/filter-chip flex h-7 max-w-full items-center rounded-full bg-muted px-2.5 text-xs whitespace-nowrap transition-[padding-right] duration-[var(--resize-dur)] ease-[var(--resize-ease)] hover:pr-1.5 focus-within:pr-1.5 motion-reduce:transition-none"
                  data-slot="run-filter-chip"
                  key={attribute.key}
                  title={filterSummary(attribute.key, filters)}
                >
                  <span className="min-w-0 truncate">{filterSummary(attribute.key, filters)}</span>
                  <span
                    className="t-resize flex w-0 shrink-0 overflow-hidden group-hover/filter-chip:w-7 group-focus-within/filter-chip:w-7"
                    data-slot="run-filter-chip-remove-slot"
                  >
                    <Button
                      aria-label={`Remove ${attribute.label} filter`}
                      className="pointer-events-none ml-1 size-6 shrink-0 rounded-full opacity-0 transition-opacity duration-[var(--resize-dur)] ease-[var(--resize-ease)] group-hover/filter-chip:pointer-events-auto group-hover/filter-chip:opacity-100 group-focus-within/filter-chip:pointer-events-auto group-focus-within/filter-chip:opacity-100 hover:bg-foreground/10 motion-reduce:transition-none dark:hover:bg-foreground/15"
                      onClick={() => onChange(clearAttribute(attribute.key, filters))}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <XIcon aria-hidden="true" className="size-3" />
                    </Button>
                  </span>
                </div>
              ))}
        {updating ? (
          <span aria-live="polite" className="text-xs text-muted-foreground">
            Updating…
          </span>
        ) : null}
      </div>
      <Popover
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) {
            setActiveAttribute(null)
            setAttributeQuery('')
          }
        }}
        open={open}
      >
        <PopoverTrigger
          render={
            <Button className="shrink-0 border-0" size="sm" variant="ghost">
              <ListFilterIcon aria-hidden="true" />
              Filters
              {activeCount > 0 ? (
                <Badge className="h-5 min-w-5 px-1.5" variant="secondary">
                  {activeCount}
                </Badge>
              ) : null}
            </Button>
          }
          aria-label={activeCount === 0 ? 'Filters' : `Filters, ${activeCount} active`}
        />
        <PopoverContent align="end" className="w-[min(18rem,calc(100vw-2rem))] overflow-hidden">
          {activeAttribute === null ? (
            <>
              <div className="flex h-12 items-center border-b px-4">
                <span className="flex-1 text-sm font-semibold">Filters</span>
                <PopoverClose
                  aria-label="Close filters"
                  render={<Button size="icon-sm" variant="ghost" />}
                >
                  <XIcon aria-hidden="true" />
                </PopoverClose>
              </div>
              <div className="p-3">
                <div className="relative">
                  <SearchIcon
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    aria-label="Search"
                    autoFocus
                    className="pl-9"
                    onChange={(event) => setAttributeQuery(event.target.value)}
                    placeholder="Search…"
                    value={attributeQuery}
                  />
                </div>
                <div className="mt-2 space-y-0.5">
                  {visibleAttributes.length === 0 ? (
                    <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                      No attributes found.
                    </p>
                  ) : (
                    visibleAttributes.map((attribute) => {
                      const Icon = attribute.icon
                      const count = valueCount(attribute.key, filters)
                      return (
                        <Button
                          aria-label={
                            count === 0 ? attribute.label : `${attribute.label}, ${count} selected`
                          }
                          className="h-10 w-full justify-start px-2"
                          key={attribute.key}
                          onClick={() => setActiveAttribute(attribute.key)}
                          variant="ghost"
                        >
                          <Icon aria-hidden="true" className="text-muted-foreground" />
                          <span className="flex-1 text-left">{attribute.label}</span>
                          {count > 0 ? (
                            <Badge className="h-5 min-w-5 px-1.5" variant="secondary">
                              {count}
                            </Badge>
                          ) : null}
                          <ChevronRightIcon aria-hidden="true" className="text-muted-foreground" />
                        </Button>
                      )
                    })
                  )}
                </div>
              </div>
            </>
          ) : (
            <AttributeEditor
              attribute={activeAttribute}
              filters={filters}
              onBack={() => setActiveAttribute(null)}
              onChange={onChange}
            />
          )}
        </PopoverContent>
      </Popover>
    </>
  )
}
