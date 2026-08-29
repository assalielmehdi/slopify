import { useCallback, useEffect, useReducer, useRef } from 'react'

import type { AgentTrace } from '@slopify/shared'

import type { ApiClient, RunDetailResponse } from '@/lib/api-client'
import {
  reconcileRunEvents,
  runEventStreamUrl,
  type RunEventSubscription,
  type RunEvent,
} from '@/lib/event-stream'
import {
  lastRunEventSequence,
  latestExecutions,
  terminalRunStatuses,
  type NodeExecution,
} from '@/lib/live-run'
import { announceWorkflowRunOutcomesChanged } from '@/lib/workflow-run-outcome-events'

export type LiveRunClient = Pick<ApiClient, 'cancelRun' | 'getRun'> &
  Partial<Pick<ApiClient, 'getAgentTrace'>>

interface RunStreamState {
  readonly detail: RunDetailResponse | undefined
  readonly events: readonly RunEvent[]
  readonly loading: boolean
  readonly loadError: string | undefined
  readonly streamError: string | undefined
  readonly streamStatus: string
  readonly cancelling: boolean
  readonly cancelError: string | undefined
}

type RunStreamAction =
  | Readonly<{ type: 'reset' }>
  | Readonly<{
      type: 'snapshot'
      detail: RunDetailResponse | undefined
      events: readonly RunEvent[]
    }>
  | Readonly<{ type: 'loaded' }>
  | Readonly<{ type: 'loadFailed'; message: string }>
  | Readonly<{ type: 'streamFailed'; message: string | undefined }>
  | Readonly<{ type: 'streamStatusChanged'; status: string }>
  | Readonly<{ type: 'cancellationStarted' }>
  | Readonly<{ type: 'cancellationFinished' }>
  | Readonly<{ type: 'cancellationFailed'; message: string }>

const initialRunStreamState: RunStreamState = {
  detail: undefined,
  events: [],
  loading: true,
  loadError: undefined,
  streamError: undefined,
  streamStatus: 'Connecting',
  cancelling: false,
  cancelError: undefined,
}

const runStreamReducer = (state: RunStreamState, action: RunStreamAction): RunStreamState => {
  switch (action.type) {
    case 'reset':
      return initialRunStreamState
    case 'snapshot':
      return { ...state, detail: action.detail ?? state.detail, events: action.events }
    case 'loaded':
      return { ...state, loading: false }
    case 'loadFailed':
      return { ...state, loadError: action.message }
    case 'streamFailed':
      return { ...state, streamError: action.message }
    case 'streamStatusChanged':
      return { ...state, streamStatus: action.status }
    case 'cancellationStarted':
      return { ...state, cancelling: true, cancelError: undefined }
    case 'cancellationFinished':
      return { ...state, cancelling: false }
    case 'cancellationFailed':
      return { ...state, cancelError: action.message }
  }
}

export function useLiveRunStream({
  client,
  connect,
  runId,
}: Readonly<{ client: LiveRunClient; connect: RunEventSubscription; runId: string }>) {
  const mounted = useRef(false)
  const detailRef = useRef<RunDetailResponse | undefined>(undefined)
  const eventsRef = useRef<readonly RunEvent[]>([])
  const snapshotSequence = useRef(0)
  const announcedOutcome = useRef<string | undefined>(undefined)
  const closeSubscription = useRef<(() => void) | undefined>(undefined)
  const refreshSnapshot = useRef<() => Promise<void>>(async () => undefined)
  const [state, dispatch] = useReducer(runStreamReducer, initialRunStreamState)

  useEffect(() => {
    mounted.current = true
    eventsRef.current = []
    snapshotSequence.current = 0
    announcedOutcome.current = undefined
    detailRef.current = undefined
    dispatch({ type: 'reset' })
    let active = true
    let disconnected = false
    let latestSnapshotRequest = 0

    const close = () => {
      closeSubscription.current?.()
      closeSubscription.current = undefined
      if (active) dispatch({ type: 'streamStatusChanged', status: 'Closed' })
    }

    const applySnapshot = (next: RunDetailResponse) => {
      if (next.run.runId !== runId)
        throw new Error('Run snapshot identity does not match the route')
      const reconciliation = reconcileRunEvents(eventsRef.current, next.events)
      if (reconciliation.requiresSnapshot) throw new Error('Run snapshot contains an event gap')
      eventsRef.current = reconciliation.events

      const nextSequence = lastRunEventSequence(next.events)
      let reconciledDetail: RunDetailResponse | undefined
      if (nextSequence >= snapshotSequence.current) {
        snapshotSequence.current = nextSequence
        reconciledDetail = { ...next, events: reconciliation.events }
        detailRef.current = reconciledDetail
      }
      dispatch({ type: 'snapshot', detail: reconciledDetail, events: reconciliation.events })
      dispatch({ type: 'streamFailed', message: undefined })
      if (next.run.status === 'SUCCEEDED' || next.run.status === 'FAILED') {
        const outcomeKey = `${next.run.runId}:${next.run.status}`
        if (announcedOutcome.current !== outcomeKey) {
          announcedOutcome.current = outcomeKey
          announceWorkflowRunOutcomesChanged()
        }
      }
      if (terminalRunStatuses.has(next.run.status)) close()
    }

    const loadSnapshot = async (initial = false) => {
      const request = ++latestSnapshotRequest
      try {
        const next = await client.getRun(runId)
        if (!active) return
        applySnapshot(next)
      } catch (cause) {
        if (!active || request !== latestSnapshotRequest) return
        const message = cause instanceof Error ? cause.message : 'Run snapshot could not be loaded.'
        dispatch(initial ? { type: 'loadFailed', message } : { type: 'streamFailed', message })
      } finally {
        if (initial && active) dispatch({ type: 'loaded' })
      }
    }
    refreshSnapshot.current = () => loadSnapshot(false)

    const start = async () => {
      await loadSnapshot(true)
      if (!active || detailRef.current === undefined) return
      if (terminalRunStatuses.has(detailRef.current.run.status)) {
        dispatch({ type: 'streamStatusChanged', status: 'Closed' })
        return
      }
      try {
        closeSubscription.current = connect(runEventStreamUrl(runId), {
          onDisconnect: () => {
            if (!active) return
            disconnected = true
            dispatch({ type: 'streamStatusChanged', status: 'Reconnecting' })
            void loadSnapshot()
          },
          onOpen: () => {
            if (!active) return
            const shouldReconcile = disconnected
            disconnected = false
            dispatch({ type: 'streamStatusChanged', status: 'Live' })
            if (shouldReconcile) void loadSnapshot()
          },
          onInvalidEvent: (cause) => {
            if (!active) return
            dispatch({
              type: 'streamFailed',
              message: cause instanceof Error ? cause.message : 'Run event is invalid.',
            })
            dispatch({ type: 'streamStatusChanged', status: 'Reconnecting' })
            void loadSnapshot()
          },
          onEvent: (event) => {
            if (!active) return
            if (event.runId !== runId) {
              dispatch({
                type: 'streamFailed',
                message: 'Run event identity does not match the route.',
              })
              void loadSnapshot()
              return
            }
            const previousSequence = lastRunEventSequence(eventsRef.current)
            const reconciliation = reconcileRunEvents(eventsRef.current, [event])
            if (reconciliation.requiresSnapshot) {
              dispatch({ type: 'streamStatusChanged', status: 'Reconnecting' })
              void loadSnapshot()
              return
            }
            if (event.sequence <= previousSequence) return
            eventsRef.current = reconciliation.events
            dispatch({ type: 'snapshot', detail: undefined, events: reconciliation.events })
            if (
              event.type === 'RUN_SUCCEEDED' ||
              event.type === 'RUN_FAILED' ||
              event.type === 'RUN_CANCELLED'
            ) {
              close()
            }
            void loadSnapshot()
          },
        })
      } catch (cause) {
        dispatch({
          type: 'streamFailed',
          message: cause instanceof Error ? cause.message : 'Run event stream could not open.',
        })
        dispatch({ type: 'streamStatusChanged', status: 'Reconnecting' })
      }
    }
    void start()

    return () => {
      active = false
      mounted.current = false
      closeSubscription.current?.()
      closeSubscription.current = undefined
    }
  }, [client, connect, runId])

  const cancel = async (cancellable: boolean) => {
    if (!cancellable || state.cancelling) return
    dispatch({ type: 'cancellationStarted' })
    try {
      const confirmed = await client.cancelRun(runId, { reason: 'Cancelled from the workbench' })
      if (!mounted.current) return
      const current = detailRef.current
      if (current !== undefined) {
        const next = { ...current, run: { ...current.run, ...confirmed } }
        detailRef.current = next
        dispatch({ type: 'snapshot', detail: next, events: eventsRef.current })
      }
      if (terminalRunStatuses.has(confirmed.status)) {
        closeSubscription.current?.()
        closeSubscription.current = undefined
        dispatch({ type: 'streamStatusChanged', status: 'Closed' })
      }
      await refreshSnapshot.current()
    } catch (cause) {
      if (mounted.current) {
        dispatch({
          type: 'cancellationFailed',
          message: cause instanceof Error ? cause.message : 'Run could not be cancelled.',
        })
      }
    } finally {
      if (mounted.current) dispatch({ type: 'cancellationFinished' })
    }
  }

  return { ...state, cancel }
}

interface NodePanelState {
  readonly selectedNodeId: string | undefined
  readonly trace: AgentTrace | undefined
  readonly traceLoading: boolean
  readonly traceError: string | undefined
}

const initialNodePanelState: NodePanelState = {
  selectedNodeId: undefined,
  trace: undefined,
  traceLoading: false,
  traceError: undefined,
}

const updateNodePanel = (
  state: NodePanelState,
  update: Partial<NodePanelState>,
): NodePanelState => ({
  ...state,
  ...update,
})

export function useRunNodePanel({
  client,
  defaultNodeId,
  detail,
  runId,
}: Readonly<{
  client: LiveRunClient
  defaultNodeId: string | undefined
  detail: RunDetailResponse | undefined
  runId: string
}>) {
  const [state, update] = useReducer(updateNodePanel, initialNodePanelState)

  useEffect(() => update(initialNodePanelState), [runId])

  const open = useCallback((nodeId: string) => {
    update({ selectedNodeId: nodeId })
  }, [])

  const selectedNodeId = state.selectedNodeId ?? defaultNodeId

  const execution: NodeExecution | undefined =
    detail === undefined || selectedNodeId === undefined
      ? undefined
      : latestExecutions(detail.nodeExecutions).get(selectedNodeId)

  useEffect(() => {
    if (execution === undefined || client.getAgentTrace === undefined) {
      update({ trace: undefined, traceLoading: false, traceError: undefined })
      return
    }
    let active = true
    let interval: number | undefined
    update({ trace: undefined, traceLoading: true, traceError: undefined })

    const loadTrace = async () => {
      try {
        const next = await client.getAgentTrace?.(
          runId,
          execution.nodeExecutionId,
          execution.attemptId,
        )
        if (!active || next === undefined) return
        update({ trace: next, traceError: undefined })
        if (next.complete && interval !== undefined) {
          window.clearInterval(interval)
          interval = undefined
        }
      } catch (cause) {
        if (active) {
          update({
            traceError: cause instanceof Error ? cause.message : 'Agent trace could not be loaded.',
          })
        }
      } finally {
        if (active) update({ traceLoading: false })
      }
    }

    void loadTrace()
    if (execution.status === 'RUNNING') {
      interval = window.setInterval(() => void loadTrace(), 1_000)
    }
    return () => {
      active = false
      if (interval !== undefined) window.clearInterval(interval)
    }
  }, [client, execution, runId])

  return { ...state, selectedNodeId, execution, open }
}
