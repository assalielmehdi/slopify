'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { RunHistoryItem } from '@/components/runs/run-history-item'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { createApiClient, type ApiClient, type RunHistoryPage } from '@/lib/api-client'

const PAGE_SIZE = 20
const defaultClient = createApiClient()

type RunHistoryClient = Pick<ApiClient, 'listRuns'>

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

export function RunHistory({
  page,
  client = defaultClient,
}: Readonly<{ page: number; client?: RunHistoryClient }>) {
  const [history, setHistory] = useState<RunHistoryPage | null>(null)
  const [failed, setFailed] = useState(false)

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

  return (
    <section aria-labelledby="run-history-heading" className="mx-auto w-full max-w-6xl space-y-5">
      <div>
        <h1 id="run-history-heading" className="text-lg font-semibold">
          Run history
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Newest-first snapshots preserve the task, profile, workflow revision, and evidence used by
          each run.
        </p>
      </div>

      {failed ? (
        <Alert variant="destructive">
          <AlertTitle>Run history unavailable</AlertTitle>
          <AlertDescription>Retry after the local API is available.</AlertDescription>
        </Alert>
      ) : history === null ? (
        <div aria-label="Loading run history" className="space-y-3">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
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
        <ol className="space-y-3">
          {history.data.map((run) => (
            <RunHistoryItem key={run.runId} run={run} />
          ))}
        </ol>
      )}

      {history === null ? null : <HistoryPagination history={history} />}
    </section>
  )
}
