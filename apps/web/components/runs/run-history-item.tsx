import { ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'

import { RunStatusBadge, formatDuration, formatTimestamp } from '@/components/runs/run-status'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { RunHistoryEntry } from '@/lib/api-client'

const taskTitle = (run: RunHistoryEntry): string => {
  const snapshot = run.taskSnapshot
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    return run.taskReference
  }
  const title = snapshot.title
  return typeof title === 'string' && title.trim() !== '' ? title : run.taskReference
}

export function RunHistoryItem({ run }: Readonly<{ run: RunHistoryEntry }>) {
  return (
    <li>
      <Card>
        <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-muted-foreground">{run.taskReference}</p>
            <h2 className="mt-1 text-sm font-semibold">
              <Link
                aria-label={`Open run ${run.taskReference}: ${taskTitle(run)}`}
                className="underline-offset-4 hover:underline focus-visible:underline"
                href={`/runs/${encodeURIComponent(run.runId)}`}
                prefetch={false}
              >
                {taskTitle(run)}
              </Link>
            </h2>
          </div>
          <RunStatusBadge status={run.status} />
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Profile</dt>
              <dd>
                {run.profileDisplayName} · {run.profileId}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Workflow revision</dt>
              <dd className="font-mono">{run.revisionId}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Run</dt>
              <dd className="font-mono">{run.runId}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd>{formatTimestamp(run.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Started</dt>
              <dd>{formatTimestamp(run.startedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Completed</dt>
              <dd>{formatTimestamp(run.completedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Duration</dt>
              <dd>{run.durationMs === null ? 'Not recorded' : formatDuration(run.durationMs)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Stopped node</dt>
              <dd>{run.failedNodeId === null ? 'None' : `Stopped at ${run.failedNodeId}`}</dd>
            </div>
          </dl>

          {run.mergeRequestUrls.length > 0 ? (
            <div className="border-t pt-3">
              <ul className="flex flex-wrap gap-x-4 gap-y-2">
                {run.mergeRequestUrls.map((url, index) => (
                  <li key={url}>
                    <a
                      aria-label={`Created merge request ${index + 1} for ${run.taskReference}`}
                      className="inline-flex items-center gap-1 underline underline-offset-4"
                      href={url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Created MR {index + 1}
                      <ExternalLinkIcon aria-hidden="true" className="size-3" />
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted-foreground">
                Created merge requests do not confirm pipeline success, approval, merge, deployment,
                or release.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </li>
  )
}
