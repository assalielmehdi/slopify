import type { RunEvent } from '@loop/contracts'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDuration, formatTimestamp } from '@/components/runs/run-status'

const eventDescription = (event: RunEvent): string => {
  switch (event.type) {
    case 'RUN_STARTED':
      return `Run started for ${event.data.taskReference}`
    case 'RUN_STATUS_CHANGED':
      return `Run status changed from ${event.data.from} to ${event.data.to}`
    case 'NODE_STARTED':
      return `${event.nodeId} started`
    case 'NODE_OUTPUT':
      return `${event.nodeId} emitted ${event.data.channel}`
    case 'NODE_COMPLETED':
      return `${event.nodeId} completed${event.data.outcome === undefined ? '' : ` with ${event.data.outcome}`} in ${formatDuration(event.data.durationMs)}`
    case 'NODE_FAILED':
      return `${event.nodeId} failed with ${event.data.code} in ${formatDuration(event.data.durationMs)}`
    case 'EDGE_SELECTED':
      return `${event.nodeId} selected ${event.data.outcome} → ${event.data.targetNodeId}`
    case 'ARTIFACT_RECORDED':
      return `${event.data.artifactType} ${event.data.operation ?? 'created'} as ${event.data.artifactId}`
    case 'RUN_CANCEL_REQUESTED':
      return `Run cancellation requested${event.data.reason === undefined ? '' : `: ${event.data.reason}`}`
    case 'RUN_COMPLETED':
      return `Run completed as ${event.data.status} in ${formatDuration(event.data.durationMs)}`
  }
}

export function RunEventStream({ events }: Readonly<{ events: readonly RunEvent[] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ordered event stream</CardTitle>
        <CardDescription>{events.length} persisted and live events</CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-muted-foreground">No events recorded yet.</p>
        ) : (
          <ol className="space-y-3" aria-label="Run events">
            {events.map((event) => (
              <li className="border-l-2 border-border pl-3" key={event.sequence}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">#{event.sequence}</Badge>
                  <p className="font-medium">{eventDescription(event)}</p>
                  <time className="text-muted-foreground" dateTime={event.timestamp}>
                    {formatTimestamp(event.timestamp)}
                  </time>
                </div>
                {event.type === 'NODE_OUTPUT' ? (
                  <div className="mt-2">
                    <p className="text-muted-foreground">
                      {event.data.channel}
                      {event.data.repositoryId === undefined
                        ? ''
                        : ` · repository ${event.data.repositoryId}`}
                    </p>
                    <pre className="mt-1 overflow-x-auto border bg-muted/50 p-2 whitespace-pre-wrap">
                      {event.data.content}
                    </pre>
                  </div>
                ) : event.type === 'NODE_FAILED' ? (
                  <p className="mt-1 text-destructive">{event.data.message}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
