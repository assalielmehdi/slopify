'use client'

import { XIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

import type { AgentTrace, NodeExecutionStatus, RunEvent, RunStatus } from '@slopify/contracts'
import type { AgentNode } from '@slopify/workflow-model'

import { RunNodePanel } from '@/components/runs/run-node-panel'
import { formatDuration, formatTimestamp, RunStatusBadge } from '@/components/runs/run-status'
import { WorkflowCanvas } from '@/components/workflow/workflow-canvas'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createApiClient, type ApiClient, type RunDetailResponse } from '@/lib/api-client'
import {
  connectRunEventStream,
  reconcileRunEvents,
  runEventStreamUrl,
  type RunEventConnector,
} from '@/lib/event-stream'

type LiveRunClient = Pick<ApiClient, 'cancelRun' | 'getRun'> &
  Partial<Pick<ApiClient, 'getAgentTrace'>>
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
    detail.run.workflowSnapshot.nodes
      .filter(({ type }) => type === 'agent')
      .map((node) => [node.id, 'PENDING' as const]),
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

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

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
  const panelRef = useRef<HTMLDivElement>(null)
  const panelInvokerRef = useRef<HTMLElement | null>(null)
  const panelOpenFrameRef = useRef<number | undefined>(undefined)
  const [detail, setDetail] = useState<RunDetailResponse>()
  const [events, setEvents] = useState<readonly RunEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [streamError, setStreamError] = useState<string>()
  const [streamStatus, setStreamStatus] = useState('Connecting')
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string>()
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [trace, setTrace] = useState<AgentTrace>()
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceError, setTraceError] = useState<string>()

  const closePanel = useCallback((restoreFocus = false) => {
    if (panelOpenFrameRef.current !== undefined) {
      window.cancelAnimationFrame(panelOpenFrameRef.current)
      panelOpenFrameRef.current = undefined
    }
    setIsPanelOpen(false)
    if (restoreFocus) window.requestAnimationFrame(() => panelInvokerRef.current?.focus())
    if (prefersReducedMotion()) setSelectedNodeId(undefined)
  }, [])

  const openPanel = useCallback((nodeId: string) => {
    if (panelOpenFrameRef.current !== undefined) {
      window.cancelAnimationFrame(panelOpenFrameRef.current)
    }
    panelInvokerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelectedNodeId(nodeId)

    if (prefersReducedMotion()) {
      setIsPanelOpen(true)
      panelOpenFrameRef.current = undefined
      return
    }

    setIsPanelOpen(false)
    panelOpenFrameRef.current = window.requestAnimationFrame(() => {
      panelOpenFrameRef.current = window.requestAnimationFrame(() => {
        setIsPanelOpen(true)
        panelOpenFrameRef.current = undefined
      })
    })
  }, [])

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
    setSelectedNodeId(undefined)
    setIsPanelOpen(false)
    setTrace(undefined)
    setTraceLoading(false)
    setTraceError(undefined)
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

  useEffect(() => {
    if (!isPanelOpen) return

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return
      closePanel(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closePanel(true)
    }

    document.addEventListener('pointerdown', handleOutsidePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closePanel, isPanelOpen])

  useEffect(
    () => () => {
      if (panelOpenFrameRef.current !== undefined) {
        window.cancelAnimationFrame(panelOpenFrameRef.current)
      }
    },
    [],
  )

  const traceExecution =
    detail === undefined || selectedNodeId === undefined
      ? undefined
      : latestExecutions(detail.nodeExecutions).get(selectedNodeId)

  useEffect(() => {
    if (!isPanelOpen) return
    if (
      traceExecution?.attemptId === null ||
      traceExecution === undefined ||
      client.getAgentTrace === undefined
    ) {
      setTrace(undefined)
      setTraceLoading(false)
      setTraceError(undefined)
      return
    }
    let active = true
    let interval: number | undefined
    setTrace(undefined)
    setTraceLoading(true)
    setTraceError(undefined)

    const loadTrace = async () => {
      try {
        const next = await client.getAgentTrace?.(
          runId,
          traceExecution.nodeExecutionId,
          traceExecution.attemptId as string,
        )
        if (!active || next === undefined) return
        setTrace(next)
        setTraceError(undefined)
        if (next.complete && interval !== undefined) {
          window.clearInterval(interval)
          interval = undefined
        }
      } catch (cause) {
        if (active) {
          setTraceError(cause instanceof Error ? cause.message : 'Agent trace could not be loaded.')
        }
      } finally {
        if (active) setTraceLoading(false)
      }
    }

    void loadTrace()
    if (traceExecution.status === 'RUNNING') {
      interval = window.setInterval(() => void loadTrace(), 1_000)
    }
    return () => {
      active = false
      if (interval !== undefined) window.clearInterval(interval)
    }
  }, [client, isPanelOpen, runId, traceExecution])

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
  const statuses = nodeStatusesFrom(detail, events)
  const cancellationRequested = events.some(({ type }) => type === 'RUN_CANCEL_REQUESTED')
  const cancellable =
    status === 'RUNNING' &&
    currentNodeId !== null &&
    statuses[currentNodeId] === 'RUNNING' &&
    !cancellationRequested
  const agentNodes = detail.run.workflowSnapshot.nodes.filter(
    (node): node is AgentNode => node.type === 'agent',
  )
  const currentAgentId =
    currentNodeId !== null && agentNodes.some(({ id }) => id === currentNodeId)
      ? currentNodeId
      : undefined
  const selectedNode = agentNodes.find(({ id }) => id === selectedNodeId)
  const selectedExecution =
    selectedNode === undefined
      ? undefined
      : latestExecutions(detail.nodeExecutions).get(selectedNode.id)

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
    <section className="relative flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden p-6">
      <Card size="sm" className="shrink-0" aria-label="Run summary">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs/4 font-medium text-muted-foreground">Run ID</p>
            <h1 className="mt-1 truncate font-mono text-[18px]/6 font-semibold tracking-[-0.01em]">
              {detail.run.runId}
            </h1>
          </div>
          <div>
            <p className="text-xs/4 font-medium text-muted-foreground">Status</p>
            <div className="mt-1">
              <RunStatusBadge status={status} />
            </div>
          </div>
          <div>
            <p className="text-xs/4 font-medium text-muted-foreground">Started</p>
            <p className="mt-1 font-medium tabular-nums">{formatTimestamp(detail.run.startedAt)}</p>
          </div>
          <div>
            <p className="text-xs/4 font-medium text-muted-foreground">Duration</p>
            <p className="mt-1 font-medium tabular-nums">
              <ElapsedTime
                completedAt={detail.run.completedAt}
                running={status === 'RUNNING'}
                startedAt={detail.run.startedAt}
              />
            </p>
          </div>
          {cancellable || cancelling ? (
            <Button variant="destructive" disabled={cancelling} onClick={() => void cancel()}>
              {cancelling ? 'Cancelling…' : 'Cancel run'}
            </Button>
          ) : null}
          <Badge className="sr-only" aria-live="polite">
            {streamStatus}
          </Badge>
        </CardContent>
      </Card>

      {streamError === undefined ? null : (
        <Alert variant="destructive" className="shrink-0">
          <AlertTitle>Live updates delayed</AlertTitle>
          <AlertDescription>{streamError}</AlertDescription>
        </Alert>
      )}
      {cancelError === undefined ? null : (
        <Alert variant="destructive" className="shrink-0">
          <AlertTitle>Run not cancelled</AlertTitle>
          <AlertDescription>{cancelError}</AlertDescription>
        </Alert>
      )}

      <div className="min-h-0 flex-1">
        <WorkflowCanvas
          workflow={detail.run.workflowSnapshot}
          selectedNodeId={selectedNodeId ?? currentAgentId ?? agentNodes[0]?.id}
          onNodeSelect={openPanel}
          recentRunStatuses={statuses}
        />
      </div>

      {selectedNode === undefined ? null : (
        <div
          ref={panelRef}
          data-testid="run-node-panel-shell"
          data-open={isPanelOpen}
          className="provider-floating-panel-shell absolute inset-y-3 right-3 z-30 w-[min(34rem,calc(100%-1.5rem))]"
          style={
            {
              '--panel-open-dur': '350ms',
              '--panel-close-dur': '350ms',
              '--panel-translate-y': '0px',
            } as CSSProperties
          }
          onTransitionEnd={(event) => {
            if (
              event.target === event.currentTarget &&
              event.propertyName === 'translate' &&
              !isPanelOpen
            ) {
              setSelectedNodeId(undefined)
            }
          }}
        >
          <aside
            role="dialog"
            aria-modal="false"
            aria-labelledby="run-node-panel-title"
            data-layout="floating"
            data-open={isPanelOpen}
            className="t-panel-slide flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-overlay)]"
          >
            <header className="relative shrink-0 border-b border-border p-6 pr-14">
              <h2
                id="run-node-panel-title"
                className="text-[18px]/6 font-semibold tracking-[-0.01em]"
              >
                {selectedNode.name}
              </h2>
              <p className="mt-1 break-all font-mono text-xs/4 text-muted-foreground">
                {selectedNode.id}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close job details"
                onClick={() => closePanel(true)}
                className="absolute top-3 right-3 size-10 sm:size-9"
              >
                <XIcon aria-hidden="true" />
              </Button>
            </header>
            <RunNodePanel
              execution={selectedExecution}
              node={selectedNode}
              status={statuses[selectedNode.id] ?? 'PENDING'}
              trace={trace}
              traceError={traceError}
              traceLoading={traceLoading}
            />
          </aside>
        </div>
      )}
    </section>
  )
}
