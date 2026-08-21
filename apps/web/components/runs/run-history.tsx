'use client'

import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import { RunStatusBadge, formatDuration, formatTimestamp } from '@/components/runs/run-status'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  createApiClient,
  type ApiClient,
  type RunHistoryEntry,
  type RunHistoryPage,
} from '@/lib/api-client'

const PAGE_SIZE = 20
const defaultClient = createApiClient()

type RunHistoryClient = Pick<ApiClient, 'listRuns'>
type StatusFilter = 'ALL' | RunHistoryEntry['status']
type SortKey = 'runId' | 'revisionId' | 'startedAt' | 'durationMs' | 'status'
type SortDirection = 'ascending' | 'descending'

const statusFilters: readonly StatusFilter[] = [
  'ALL',
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
]

const sortableColumns: readonly { key: SortKey; label: string }[] = [
  { key: 'runId', label: 'Run ID' },
  { key: 'revisionId', label: 'Revision' },
  { key: 'startedAt', label: 'Started' },
  { key: 'durationMs', label: 'Duration' },
  { key: 'status', label: 'Status' },
]

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

function HistoryPagination({ history }: Readonly<{ history: RunHistoryPage }>) {
  const { page, totalItems, totalPages } = history.pagination

  return (
    <nav aria-label="Run history pagination" className="flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link
          aria-label="Previous page"
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
          href={`/runs?page=${page - 1}`}
        >
          Previous
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'opacity-50')}
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
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
          href={`/runs?page=${page + 1}`}
        >
          Next
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'opacity-50')}
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
        className="-ml-2"
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
}: Readonly<{ page: number; client?: RunHistoryClient }>) {
  const [history, setHistory] = useState<RunHistoryPage | null>(null)
  const [failed, setFailed] = useState(false)
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [revision, setRevision] = useState('ALL')
  const [sortKey, setSortKey] = useState<SortKey>('startedAt')
  const [sortDirection, setSortDirection] = useState<SortDirection>('descending')

  useEffect(() => {
    let active = true
    setHistory(null)
    setFailed(false)

    void client.listRuns({ page, pageSize: PAGE_SIZE }).then(
      (result) => {
        if (active) setHistory(result)
      },
      () => {
        if (active) setFailed(true)
      },
    )

    return () => {
      active = false
    }
  }, [client, page])

  const revisions = useMemo(
    () => [...new Set(history?.data.map((run) => run.revisionId) ?? [])].sort(),
    [history],
  )
  const visibleRuns = useMemo(() => {
    const filtered =
      history?.data.filter(
        (run) =>
          (status === 'ALL' || run.status === status) &&
          (revision === 'ALL' || run.revisionId === revision),
      ) ?? []
    const direction = sortDirection === 'ascending' ? 1 : -1
    return [...filtered].sort((left, right) => {
      const comparison = compareRuns(left, right, sortKey)
      return comparison === 0 ? left.runId.localeCompare(right.runId) : comparison * direction
    })
  }, [history, revision, sortDirection, sortKey, status])

  const sortBy = (nextKey: SortKey) => {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === 'ascending' ? 'descending' : 'ascending'))
      return
    }
    setSortKey(nextKey)
    setSortDirection('ascending')
  }

  return (
    <section aria-label="Runs" className="w-full space-y-4">
      <div
        role="search"
        aria-label="Run filters"
        className="flex flex-wrap gap-3 rounded-lg border bg-card p-4 shadow-xs"
      >
        <Field className="w-48">
          <FieldLabel htmlFor="run-status-filter">Run status</FieldLabel>
          <NativeSelect
            className="w-full"
            id="run-status-filter"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            {statusFilters.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value === 'ALL'
                  ? 'All statuses'
                  : `${value.charAt(0)}${value.slice(1).toLowerCase()}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className="w-56">
          <FieldLabel htmlFor="run-revision-filter">Workflow revision</FieldLabel>
          <NativeSelect
            className="w-full"
            id="run-revision-filter"
            value={revision}
            onChange={(event) => setRevision(event.target.value)}
          >
            <NativeSelectOption value="ALL">All revisions</NativeSelectOption>
            {revisions.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {failed ? (
        <Alert variant="destructive">
          <AlertTitle>Run history unavailable</AlertTitle>
          <AlertDescription>Retry after the local API is available.</AlertDescription>
        </Alert>
      ) : history === null ? (
        <div aria-label="Loading run history" className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : history.data.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">No runs yet</p>
            <p className="mt-1 text-muted-foreground">
              Start a run to create the first historical snapshot.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <Table aria-label="Workflow runs">
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
              {visibleRuns.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={5}>
                    No runs match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                visibleRuns.map((run) => (
                  <TableRow key={run.runId}>
                    <TableCell className="font-mono font-medium">
                      <Link
                        aria-label={`Open run ${run.runId}`}
                        className="underline-offset-4 hover:underline focus-visible:underline"
                        href={`/runs/${encodeURIComponent(run.runId)}`}
                        prefetch={false}
                      >
                        {run.runId}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono">{run.revisionId}</TableCell>
                    <TableCell>{formatTimestamp(run.startedAt)}</TableCell>
                    <TableCell>
                      {run.durationMs === null ? 'Not recorded' : formatDuration(run.durationMs)}
                    </TableCell>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <div className="border-t bg-muted/25 px-4 py-3">
            <HistoryPagination history={history} />
          </div>
        </div>
      )}
    </section>
  )
}
