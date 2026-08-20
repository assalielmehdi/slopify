'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import type { NodeExecutionStatus, RunEvent, RunStatus } from '@loop/contracts'

import { RunEventStream } from '@/components/runs/run-event-stream'
import {
  formatDuration,
  formatTimestamp,
  NodeStatusBadge,
  RunStatusBadge,
} from '@/components/runs/run-status'
import { WorkflowCanvas } from '@/components/workflow/workflow-canvas'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createApiClient, type ApiClient, type RunDetailResponse } from '@/lib/api-client'
import {
  connectRunEventStream,
  reconcileRunEvents,
  runEventStreamUrl,
  type RunEventConnector,
} from '@/lib/event-stream'

type LiveRunClient = Pick<ApiClient, 'cancelRun' | 'getRun'>
type NodeExecution = RunDetailResponse['nodeExecutions'][number]

const defaultClient = createApiClient()
const terminalStatuses = new Set<RunStatus>(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'])

const lastSequence = (events: readonly RunEvent[]): number => events.at(-1)?.sequence ?? 0

const runStatusFrom = (snapshotStatus: RunStatus, events: readonly RunEvent[]): RunStatus => {
  if (terminalStatuses.has(snapshotStatus)) return snapshotStatus
  let status = snapshotStatus
  for (const event of events) {
    if (event.type === 'RUN_STATUS_CHANGED') status = event.data.to
    if (event.type === 'RUN_COMPLETED') status = event.data.status
  }
  return status
}

const currentNodeFrom = (
  detail: RunDetailResponse,
  status: RunStatus,
  events: readonly RunEvent[],
): string | null => {
  if (terminalStatuses.has(status)) return null
  let currentNodeId = detail.run.currentNodeId
  for (const event of events) {
    if (event.type === 'NODE_STARTED') currentNodeId = event.nodeId
  }
  return currentNodeId
}

const latestExecutions = (
  executions: readonly NodeExecution[],
): ReadonlyMap<string, NodeExecution> => {
  const latest = new Map<string, NodeExecution>()
  for (const execution of executions) {
    const current = latest.get(execution.nodeId)
    if (current === undefined || execution.executionIndex >= current.executionIndex) {
      latest.set(execution.nodeId, execution)
    }
  }
  return latest
}

const nodeStatusesFrom = (
  detail: RunDetailResponse,
  events: readonly RunEvent[],
): Readonly<Record<string, NodeExecutionStatus>> => {
  const statuses: Record<string, NodeExecutionStatus> = Object.fromEntries(
    detail.workflowRevision.nodes.map((node) => [node.id, 'PENDING' as const]),
  )
  for (const execution of latestExecutions(detail.nodeExecutions).values()) {
    statuses[execution.nodeId] = execution.status
  }
  for (const event of events) {
    if (event.type === 'NODE_STARTED') statuses[event.nodeId] = 'RUNNING'
    if (event.type === 'NODE_COMPLETED') statuses[event.nodeId] = 'SUCCEEDED'
    if (event.type === 'NODE_FAILED') {
      statuses[event.nodeId] = event.data.code === 'EXECUTOR_CANCELLED' ? 'CANCELLED' : 'FAILED'
    }
  }
  return statuses
}

const safeWebUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

const urlsFromJson = (value: unknown, urls = new Set<string>()): readonly string[] => {
  const url = safeWebUrl(value)
  if (url !== undefined) urls.add(url)
  else if (Array.isArray(value)) {
    for (const item of value) urlsFromJson(item, urls)
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) urlsFromJson(item, urls)
  }
  return [...urls]
}

const objectString = (value: unknown, key: string): string | undefined => {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined
  const candidate = value[key as keyof typeof value]
  return typeof candidate === 'string' ? candidate : undefined
}

function ElapsedTime({
  completedAt,
  running,
  startedAt,
}: Readonly<{ completedAt: string | null; running: boolean; startedAt: string | null }>) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [running])

  if (startedAt === null) return <>Not started</>
  const end = completedAt === null ? now : Date.parse(completedAt)
  return <>{formatDuration(Math.max(0, end - Date.parse(startedAt)))}</>
}

function NodeProgress({
  detail,
  statuses,
}: Readonly<{
  detail: RunDetailResponse
  statuses: Readonly<Record<string, NodeExecutionStatus>>
}>) {
  const executions = latestExecutions(detail.nodeExecutions)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Node progress</CardTitle>
        <CardDescription>
          Latest execution state for every node in the pinned revision.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {detail.workflowRevision.nodes.map((node) => {
          const execution = executions.get(node.id)
          const status = statuses[node.id] ?? 'PENDING'
          return (
            <article className="space-y-2 border p-3" key={node.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{node.name}</h3>
                <NodeStatusBadge status={status} />
              </div>
              <p className="font-mono text-muted-foreground">{node.id}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2">
                <dt>Started</dt>
                <dd>{formatTimestamp(execution?.startedAt ?? null)}</dd>
                <dt>Ended</dt>
                <dd>{formatTimestamp(execution?.completedAt ?? null)}</dd>
                <dt>Duration</dt>
                <dd>
                  {execution?.durationMs === null || execution?.durationMs === undefined
                    ? 'Not recorded'
                    : formatDuration(execution.durationMs)}
                </dd>
                <dt>Outcome</dt>
                <dd>{execution?.outcome ?? 'Not recorded'}</dd>
              </dl>
              {execution?.errorMessage === null || execution?.errorMessage === undefined ? null : (
                <p className="text-destructive">
                  {execution.errorCode}: {execution.errorMessage}
                </p>
              )}
            </article>
          )
        })}
      </CardContent>
    </Card>
  )
}

function RepositoryEvidence({ detail }: Readonly<{ detail: RunDetailResponse }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Repository selection and delivery</CardTitle>
        <CardDescription>
          Ordered candidates, server-recorded selection rationale, isolated worktrees, checks,
          reviews, branches, and delivery evidence.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-2">
        {detail.profileSnapshot.repositories.map((repository) => {
          const selected = detail.repositorySelection?.selected.find(
            ({ repositoryId }) => repositoryId === repository.repositoryId,
          )
          const excluded = detail.repositorySelection?.excluded.find(
            ({ repositoryId }) => repositoryId === repository.repositoryId,
          )
          const workspace = detail.workspaces.find(
            ({ repositoryId }) => repositoryId === repository.repositoryId,
          )
          const delivery = detail.deliveryEvidence.find(
            ({ repositoryId }) => repositoryId === repository.repositoryId,
          )
          const mergeRequestUrl = safeWebUrl(delivery?.mergeRequestUrl)
          return (
            <article className="space-y-3 border p-3" key={repository.repositoryId}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-medium">{repository.displayName}</h3>
                  <p className="font-mono text-muted-foreground">{repository.repositoryId}</p>
                </div>
                <Badge variant={selected === undefined ? 'outline' : 'secondary'}>
                  {selected !== undefined
                    ? 'Selected'
                    : excluded !== undefined
                      ? 'Excluded'
                      : 'Candidate'}
                </Badge>
              </div>
              <p>{repository.purpose}</p>
              <p>
                <span className="font-medium">Selection rationale:</span>{' '}
                {selected?.rationale ?? excluded?.rationale ?? 'Selection pending'}
              </p>
              {selected === undefined ? null : (
                <p>
                  <span className="font-medium">Responsibility:</span> {selected.responsibility}
                </p>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 break-all">
                <dt>Repository</dt>
                <dd>{repository.repositoryPath}</dd>
                <dt>Configured target</dt>
                <dd>{repository.targetBranch}</dd>
                <dt>Worktree</dt>
                <dd>{workspace?.worktreePath ?? 'Not created'}</dd>
                <dt>Remote</dt>
                <dd>{workspace?.remote ?? repository.remote}</dd>
                <dt>Source branch</dt>
                <dd>{workspace?.sourceBranch ?? 'Not created'}</dd>
                <dt>Target branch</dt>
                <dd>{workspace?.targetBranch ?? repository.targetBranch}</dd>
                <dt>Base SHA</dt>
                <dd>{workspace?.baseSha ?? 'Not recorded'}</dd>
                <dt>Delivery status</dt>
                <dd>{delivery?.status.replaceAll('_', ' ') ?? 'Not recorded'}</dd>
                <dt>GitLab project</dt>
                <dd>{delivery?.gitlabProject ?? repository.gitlabProject}</dd>
                <dt>Merge request</dt>
                <dd>
                  {delivery?.mergeRequestIid === null || delivery?.mergeRequestIid === undefined
                    ? 'Not recorded'
                    : `!${delivery.mergeRequestIid}`}
                </dd>
                <dt>Head SHA</dt>
                <dd>{delivery?.headSha ?? 'Not recorded'}</dd>
              </dl>
              {delivery === undefined ? null : (
                <div>
                  <p className="font-medium">Verification and review evidence</p>
                  <pre className="mt-1 overflow-x-auto border bg-muted/50 p-2 whitespace-pre-wrap">
                    {JSON.stringify(delivery.evidence, null, 2)}
                  </pre>
                </div>
              )}
              {mergeRequestUrl === undefined ? null : (
                <Link href={mergeRequestUrl} target="_blank" rel="noreferrer">
                  Merge request !{delivery?.mergeRequestIid}
                </Link>
              )}
            </article>
          )
        })}
      </CardContent>
    </Card>
  )
}

function Artifacts({ detail }: Readonly<{ detail: RunDetailResponse }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Artifacts</CardTitle>
        <CardDescription>Local artifact content and published references.</CardDescription>
      </CardHeader>
      <CardContent>
        {detail.artifacts.length === 0 ? (
          <p className="text-muted-foreground">No artifacts recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {detail.artifacts.map((artifact) => (
              <article className="space-y-2 border p-3" key={artifact.artifactId}>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{artifact.artifactType.replaceAll('_', ' ')}</Badge>
                  <span className="font-mono">{artifact.artifactId}</span>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap">{artifact.content}</pre>
                {urlsFromJson(artifact.metadata).map((url, index) => (
                  <Link className="mr-3" href={url} key={url} target="_blank" rel="noreferrer">
                    Artifact link {index + 1}
                  </Link>
                ))}
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export interface LiveRunProps {
  readonly client?: LiveRunClient
  readonly connect?: RunEventConnector
  readonly runId: string
}

export function LiveRun({
  client = defaultClient,
  connect = connectRunEventStream,
  runId,
}: LiveRunProps) {
  const mounted = useRef(false)
  const detailRef = useRef<RunDetailResponse | undefined>(undefined)
  const eventsRef = useRef<readonly RunEvent[]>([])
  const snapshotSequence = useRef(0)
  const closeConnection = useRef<(() => void) | undefined>(undefined)
  const refreshSnapshot = useRef<() => Promise<void>>(async () => undefined)
  const [detail, setDetail] = useState<RunDetailResponse>()
  const [events, setEvents] = useState<readonly RunEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [streamError, setStreamError] = useState<string>()
  const [streamStatus, setStreamStatus] = useState('Connecting')
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string>()

  useEffect(() => {
    mounted.current = true
    eventsRef.current = []
    snapshotSequence.current = 0
    detailRef.current = undefined
    setDetail(undefined)
    setEvents([])
    setLoading(true)
    setLoadError(undefined)
    setStreamError(undefined)
    setStreamStatus('Connecting')
    let active = true
    let disconnected = false

    const close = () => {
      closeConnection.current?.()
      closeConnection.current = undefined
      if (active) setStreamStatus('Closed')
    }

    const applySnapshot = (next: RunDetailResponse) => {
      if (next.run.runId !== runId)
        throw new Error('Run snapshot identity does not match the route')
      const reconciliation = reconcileRunEvents(eventsRef.current, next.events)
      if (reconciliation.requiresSnapshot) throw new Error('Run snapshot contains an event gap')
      eventsRef.current = reconciliation.events
      setEvents(reconciliation.events)

      const nextSequence = lastSequence(next.events)
      if (nextSequence >= snapshotSequence.current) {
        snapshotSequence.current = nextSequence
        const reconciledDetail = { ...next, events: reconciliation.events }
        detailRef.current = reconciledDetail
        setDetail(reconciledDetail)
      }
      setStreamError(undefined)
      if (terminalStatuses.has(next.run.status)) close()
    }

    const loadSnapshot = async (initial = false) => {
      try {
        const next = await client.getRun(runId)
        if (!active) return
        applySnapshot(next)
      } catch (cause) {
        if (!active) return
        const message = cause instanceof Error ? cause.message : 'Run snapshot could not be loaded.'
        if (initial) setLoadError(message)
        else setStreamError(message)
      } finally {
        if (initial && active) setLoading(false)
      }
    }
    refreshSnapshot.current = () => loadSnapshot(false)

    const start = async () => {
      await loadSnapshot(true)
      if (!active || detailRef.current === undefined) return
      if (terminalStatuses.has(detailRef.current.run.status)) {
        setStreamStatus('Closed')
        return
      }
      try {
        closeConnection.current = connect(runEventStreamUrl(runId), {
          onDisconnect: () => {
            if (!active) return
            disconnected = true
            setStreamStatus('Reconnecting')
          },
          onOpen: () => {
            if (!active) return
            const shouldReconcile = disconnected
            disconnected = false
            setStreamStatus('Live')
            if (shouldReconcile) void loadSnapshot()
          },
          onInvalidEvent: (cause) => {
            if (!active) return
            setStreamError(cause instanceof Error ? cause.message : 'Run event is invalid.')
            setStreamStatus('Reconnecting')
            void loadSnapshot()
          },
          onEvent: (event) => {
            if (!active) return
            if (event.runId !== runId) {
              setStreamError('Run event identity does not match the route.')
              void loadSnapshot()
              return
            }
            const previousSequence = lastSequence(eventsRef.current)
            const reconciliation = reconcileRunEvents(eventsRef.current, [event])
            if (reconciliation.requiresSnapshot) {
              setStreamStatus('Reconnecting')
              void loadSnapshot()
              return
            }
            if (event.sequence <= previousSequence) return
            eventsRef.current = reconciliation.events
            setEvents(reconciliation.events)
            if (
              event.type === 'RUN_COMPLETED' ||
              (event.type === 'RUN_STATUS_CHANGED' && terminalStatuses.has(event.data.to))
            ) {
              close()
            }
            if (event.type !== 'NODE_OUTPUT') void loadSnapshot()
          },
        })
      } catch (cause) {
        setStreamError(cause instanceof Error ? cause.message : 'Run event stream could not open.')
        setStreamStatus('Reconnecting')
      }
    }
    void start()

    return () => {
      active = false
      mounted.current = false
      closeConnection.current?.()
      closeConnection.current = undefined
    }
  }, [client, connect, runId])

  if (loading) return <p className="text-xs text-muted-foreground">Loading run {runId}…</p>
  if (detail === undefined) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Run unavailable</AlertTitle>
        <AlertDescription>{loadError ?? 'Run could not be loaded.'}</AlertDescription>
      </Alert>
    )
  }

  const status = runStatusFrom(detail.run.status, events)
  const currentNodeId = currentNodeFrom(detail, status, events)
  const currentNode = detail.workflowRevision.nodes.find(({ id }) => id === currentNodeId)
  const statuses = nodeStatusesFrom(detail, events)
  const selectedTransition = [...events]
    .reverse()
    .find(
      (event): event is Extract<RunEvent, { type: 'EDGE_SELECTED' }> =>
        event.type === 'EDGE_SELECTED',
    )
  const cancellationRequested = events.some(({ type }) => type === 'RUN_CANCEL_REQUESTED')
  const cancellable =
    status === 'RUNNING' &&
    currentNodeId !== null &&
    statuses[currentNodeId] === 'RUNNING' &&
    !cancellationRequested
  const taskTitle = objectString(detail.run.taskSnapshot, 'title') ?? detail.run.taskReference
  const taskUrl = safeWebUrl(objectString(detail.run.taskSnapshot, 'url'))

  const cancel = async () => {
    if (!cancellable || cancelling) return
    setCancelling(true)
    setCancelError(undefined)
    try {
      const confirmed = await client.cancelRun(runId, { reason: 'Cancelled from the workbench' })
      if (!mounted.current) return
      setDetail((current) => {
        if (current === undefined) return current
        const next = { ...current, run: confirmed }
        detailRef.current = next
        return next
      })
      if (terminalStatuses.has(confirmed.status)) {
        closeConnection.current?.()
        closeConnection.current = undefined
        setStreamStatus('Closed')
      }
      await refreshSnapshot.current()
    } catch (cause) {
      if (mounted.current) {
        setCancelError(cause instanceof Error ? cause.message : 'Run could not be cancelled.')
      }
    } finally {
      if (mounted.current) setCancelling(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-xl font-semibold">Run {detail.run.runId}</h1>
            <RunStatusBadge status={status} />
            <Badge variant="outline" aria-live="polite">
              {streamStatus}
            </Badge>
          </div>
          <p>{taskTitle}</p>
          <p className="text-muted-foreground">
            Pinned revision {detail.run.revisionId} · {detail.profileSnapshot.displayName} · Task{' '}
            {taskUrl === undefined ? (
              detail.run.taskReference
            ) : (
              <Link href={taskUrl} target="_blank" rel="noreferrer">
                {detail.run.taskReference}
              </Link>
            )}
          </p>
        </div>
        {cancellable || cancelling ? (
          <Button variant="destructive" disabled={cancelling} onClick={() => void cancel()}>
            {cancelling ? 'Cancelling…' : 'Cancel run'}
          </Button>
        ) : null}
      </header>

      {streamError === undefined ? null : (
        <Alert variant="destructive">
          <AlertTitle>Live updates delayed</AlertTitle>
          <AlertDescription>{streamError}</AlertDescription>
        </Alert>
      )}
      {cancelError === undefined ? null : (
        <Alert variant="destructive">
          <AlertTitle>Run not cancelled</AlertTitle>
          <AlertDescription>{cancelError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Run status</CardTitle>
          <CardDescription>Server-confirmed lifecycle and active transition.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Elapsed</p>
            <p className="font-medium">
              <ElapsedTime
                completedAt={detail.run.completedAt}
                running={status === 'RUNNING'}
                startedAt={detail.run.startedAt}
              />
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Current node</p>
            <p className="font-medium">Current node: {currentNode?.name ?? 'None'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Selected transition</p>
            <p className="font-medium">
              Selected transition:{' '}
              {selectedTransition === undefined
                ? 'None'
                : `${selectedTransition.data.outcome} → ${selectedTransition.data.targetNodeId}`}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Started</p>
            <p className="font-medium">{formatTimestamp(detail.run.startedAt)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{detail.workflowRevision.name}</CardTitle>
          <CardDescription>Pinned revision {detail.workflowRevision.revisionId}</CardDescription>
        </CardHeader>
        <CardContent>
          <WorkflowCanvas
            revision={detail.workflowRevision}
            selectedNodeId={currentNodeId ?? detail.workflowRevision.startNodeId}
            onNodeSelect={() => undefined}
            recentRunStatuses={statuses}
          />
        </CardContent>
      </Card>

      <NodeProgress detail={detail} statuses={statuses} />
      <RepositoryEvidence detail={detail} />
      <Artifacts detail={detail} />
      <RunEventStream events={events} />
    </main>
  )
}
