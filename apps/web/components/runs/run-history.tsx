'use client'

import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import {
  RunFilterControls,
  activeRunFilterCount,
  emptyRunFilters,
  type RunFilters,
} from '@/components/runs/run-filters'
import { RunStatusBadge, formatDuration, formatTimestamp } from '@/components/runs/run-status'
import { displayRunId } from '@/lib/run-id'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { RunTableSkeleton } from '@/components/runs/run-table-skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  createApiClient,
  type ApiClient,
  type ListRunsInput,
  type RunHistoryEntry,
  type RunHistoryPage,
} from '@/lib/api-client'

const PAGE_SIZE = 20
const defaultClient = createApiClient()

type RunHistoryClient = Pick<ApiClient, 'listRuns'>
type SortKey = 'runId' | 'startedAt' | 'durationMs' | 'status'
type SortDirection = 'ascending' | 'descending'

const sortableColumns: readonly { key: SortKey; label: string }[] = [
  { key: 'runId', label: 'Run ID' },
  { key: 'startedAt', label: 'Started' },
  { key: 'durationMs', label: 'Duration' },
  { key: 'status', label: 'Status' },
]

const sameLocalDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate()

export function formatRunHistoryTimestamp(timestamp: string | null, now = new Date()): string {
  if (timestamp === null) return 'Not recorded'
  const startedAt = new Date(timestamp)
  const elapsedMs = now.getTime() - startedAt.getTime()
  if (elapsedMs < 0 || !sameLocalDay(startedAt, now)) return formatTimestamp(timestamp)

  const elapsedSeconds = Math.max(1, Math.floor(elapsedMs / 1_000))
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })
  if (elapsedSeconds < 60) return formatter.format(-elapsedSeconds, 'second')
  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return formatter.format(-elapsedMinutes, 'minute')
  return formatter.format(-Math.floor(elapsedMinutes / 60), 'hour')
}

function RunStartedAt({ timestamp }: Readonly<{ timestamp: string | null }>) {
  if (timestamp === null) return <>Not recorded</>
  const exact = formatTimestamp(timestamp)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <time
            aria-label={`Started ${exact}`}
            className="tabular-nums"
            dateTime={timestamp}
            tabIndex={0}
          />
        }
      >
        {formatRunHistoryTimestamp(timestamp)}
      </TooltipTrigger>
      <TooltipContent>{exact}</TooltipContent>
    </Tooltip>
  )
}

const compareNullable = <T extends number | string>(left: T | null, right: T | null): number => {
  if (left === right) return 0
  if (left === null) return -1
  if (right === null) return 1
  return typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right))
}

const compareRuns = (left: RunHistoryEntry, right: RunHistoryEntry, key: SortKey): number => {
  if (key === 'startedAt') {
    return compareNullable(
      left.startedAt === null ? null : Date.parse(left.startedAt),
      right.startedAt === null ? null : Date.parse(right.startedAt),
    )
  }
  return compareNullable(left[key], right[key])
}

const filterSearch = (filters: RunFilters, page: number): string => {
  const search = new URLSearchParams()
  if (page > 1) search.set('page', String(page))
  if (filters.runId.trim() !== '') search.set('runId', filters.runId.trim())
  for (const status of filters.statuses) search.append('status', status)
  if (filters.startedFrom !== '') search.set('startedFrom', filters.startedFrom)
  if (filters.startedTo !== '') search.set('startedTo', filters.startedTo)
  if (filters.durationMinSeconds !== '')
    search.set('durationMinSeconds', filters.durationMinSeconds)
  if (filters.durationMaxSeconds !== '')
    search.set('durationMaxSeconds', filters.durationMaxSeconds)
  const query = search.toString()
  return query === '' ? '/runs' : `/runs?${query}`
}

const toListRunsInput = (filters: RunFilters, page: number): ListRunsInput => {
  const durationMin = Number(filters.durationMinSeconds)
  const durationMax = Number(filters.durationMaxSeconds)
  return {
    page,
    pageSize: PAGE_SIZE,
    ...(filters.runId.trim() === '' ? {} : { runId: filters.runId.trim() }),
    ...(filters.statuses.length === 0 ? {} : { statuses: filters.statuses }),
    ...(filters.startedFrom === '' ? {} : { startedFrom: `${filters.startedFrom}T00:00:00.000Z` }),
    ...(filters.startedTo === '' ? {} : { startedTo: `${filters.startedTo}T23:59:59.999Z` }),
    ...(filters.durationMinSeconds === '' || !Number.isFinite(durationMin)
      ? {}
      : { durationMinMs: Math.round(durationMin * 1_000) }),
    ...(filters.durationMaxSeconds === '' || !Number.isFinite(durationMax)
      ? {}
      : { durationMaxMs: Math.round(durationMax * 1_000) }),
  }
}

function HistoryPagination({
  filters,
  history,
}: Readonly<{ filters: RunFilters; history: RunHistoryPage }>) {
  const { page, totalItems, totalPages } = history.pagination

  return (
    <nav aria-label="Run history pagination" className="flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link
          aria-label="Previous page"
          className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'border-0')}
          href={filterSearch(filters, page - 1)}
        >
          Previous
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'border-0 opacity-50')}
        >
          Previous
        </span>
      )}
      <p aria-live="polite" className="text-center text-xs text-muted-foreground">
        Page {page} of {Math.max(1, totalPages)} · {totalItems} runs
      </p>
      {page < totalPages ? (
        <Link
          aria-label="Next page"
          className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'border-0')}
          href={filterSearch(filters, page + 1)}
        >
          Next
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'border-0 opacity-50')}
        >
          Next
        </span>
      )}
    </nav>
  )
}

function SortableHead({
  activeKey,
  direction,
  column,
  onSort,
}: Readonly<{
  activeKey: SortKey
  direction: SortDirection
  column: (typeof sortableColumns)[number]
  onSort: (key: SortKey) => void
}>) {
  const active = activeKey === column.key
  const nextDirection = active && direction === 'ascending' ? 'descending' : 'ascending'
  const Icon = active ? (direction === 'ascending' ? ArrowUpIcon : ArrowDownIcon) : ArrowUpDownIcon

  return (
    <TableHead aria-sort={active ? direction : 'none'}>
      <Button
        aria-label={`Sort by ${column.label} ${nextDirection}`}
        className="-ml-2 px-2"
        onClick={() => onSort(column.key)}
        size="sm"
        variant="ghost"
      >
        {column.label}
        <Icon aria-hidden="true" />
      </Button>
    </TableHead>
  )
}

export function RunHistory({
  page,
  client = defaultClient,
  initialFilters = emptyRunFilters,
}: Readonly<{ page: number; client?: RunHistoryClient; initialFilters?: RunFilters }>) {
  const [history, setHistory] = useState<RunHistoryPage | null>(null)
  const [failed, setFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [filters, setFilters] = useState(initialFilters)
  const [activePage, setActivePage] = useState(page)
  const [sortKey, setSortKey] = useState<SortKey>('startedAt')
  const [sortDirection, setSortDirection] = useState<SortDirection>('descending')

  useEffect(() => setActivePage(page), [page])

  useEffect(() => {
    let active = true
    setFailed(false)
    setRefreshing(true)

    void client.listRuns(toListRunsInput(filters, activePage)).then(
      (result) => {
        if (active) {
          setHistory(result)
          setRefreshing(false)
        }
      },
      () => {
        if (active) {
          setFailed(true)
          setRefreshing(false)
        }
      },
    )

    return () => {
      active = false
    }
  }, [activePage, client, filters])

  const visibleRuns = useMemo(() => {
    const direction = sortDirection === 'ascending' ? 1 : -1
    return [...(history?.data ?? [])].sort((left, right) => {
      const comparison = compareRuns(left, right, sortKey)
      return comparison === 0 ? left.runId.localeCompare(right.runId) : comparison * direction
    })
  }, [history, sortDirection, sortKey])

  const sortBy = (nextKey: SortKey) => {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === 'ascending' ? 'descending' : 'ascending'))
      return
    }
    setSortKey(nextKey)
    setSortDirection('ascending')
  }

  const updateFilters = (nextFilters: RunFilters) => {
    setFilters(nextFilters)
    setActivePage(1)
    window.history.replaceState(null, '', filterSearch(nextFilters, 1))
  }

  const activeFilterCount = activeRunFilterCount(filters)

  return (
    <section aria-busy={refreshing} aria-label="Runs" className="min-h-full w-full">
      {failed ? (
        <Alert variant="destructive" className="m-6 w-auto">
          <AlertTitle>Run history unavailable</AlertTitle>
          <AlertDescription>Retry after the local API is available.</AlertDescription>
        </Alert>
      ) : history === null ? (
        <RunTableSkeleton />
      ) : history.data.length === 0 && activeFilterCount === 0 ? (
        <div className="border-b px-6 py-16 text-center">
          <p className="font-medium">No runs yet</p>
          <p className="mt-1 text-muted-foreground">
            Start a run to create the first historical snapshot.
          </p>
        </div>
      ) : (
        <div data-testid="run-history-surface" className="w-full bg-background">
          <div
            role="toolbar"
            aria-label="Run history controls"
            className="flex min-h-12 items-center gap-2 border-b px-6 py-2"
          >
            <RunFilterControls filters={filters} onChange={updateFilters} updating={refreshing} />
          </div>
          {history.data.length === 0 ? (
            <div className="border-b px-6 py-16 text-center">
              <p className="font-medium">No runs match these filters</p>
              <p className="mt-1 text-muted-foreground">Remove a filter to broaden the results.</p>
              <Button
                className="mt-2 h-auto border-0 px-0 py-1"
                onClick={() => updateFilters(emptyRunFilters)}
                variant="link"
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <Table
              aria-label="Workflow runs"
              className={cn(
                'min-w-[44rem] transition-opacity duration-[var(--duration-quick)]',
                refreshing && 'opacity-60',
              )}
            >
              <TableHeader>
                <TableRow>
                  {sortableColumns.map((column) => (
                    <SortableHead
                      activeKey={sortKey}
                      column={column}
                      direction={sortDirection}
                      key={column.key}
                      onSort={sortBy}
                    />
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRuns.map((run) => (
                  <TableRow key={run.runId}>
                    <TableCell className="font-mono font-medium">
                      <Link
                        aria-label={`Open run ${displayRunId(run.runId)}`}
                        className="underline-offset-4 hover:underline focus-visible:underline"
                        href={`/runs/${encodeURIComponent(run.runId)}`}
                        prefetch={false}
                      >
                        {displayRunId(run.runId)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <RunStartedAt timestamp={run.startedAt} />
                    </TableCell>
                    <TableCell>
                      {run.durationMs === null ? 'Not recorded' : formatDuration(run.durationMs)}
                    </TableCell>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="border-t bg-background px-6 py-3">
            <HistoryPagination filters={filters} history={history} />
          </div>
        </div>
      )}
    </section>
  )
}
