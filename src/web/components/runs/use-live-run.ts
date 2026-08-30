import { useCallback, useEffect, useReducer, useRef } from 'react'

import type { ApiClient, RunDetailResponse } from '@/lib/api-client'
import { terminalRunStatuses } from '@/lib/live-run'
import { announceWorkflowRunOutcomesChanged } from '@/lib/workflow-run-outcome-events'

const POLL_INTERVAL_MS = 1_000

export type LiveRunClient = Pick<ApiClient, 'cancelRun' | 'getRun'>

interface RunStreamState {
  readonly detail: RunDetailResponse | undefined
  readonly loading: boolean
  readonly loadError: string | undefined
  readonly refreshError: string | undefined
  readonly cancelling: boolean
  readonly cancelError: string | undefined
}

type RunStreamAction =
  | Readonly<{ type: 'reset' }>
  | Readonly<{ type: 'loaded'; detail: RunDetailResponse }>
  | Readonly<{ type: 'loadFailed'; message: string }>
  | Readonly<{ type: 'refreshFailed'; message: string }>
  | Readonly<{ type: 'cancellationStarted' }>
  | Readonly<{ type: 'cancellationFinished' }>
  | Readonly<{ type: 'cancellationFailed'; message: string }>

const initialRunStreamState: RunStreamState = {
  detail: undefined,
  loading: true,
  loadError: undefined,
  refreshError: undefined,
  cancelling: false,
  cancelError: undefined,
}

const runStreamReducer = (state: RunStreamState, action: RunStreamAction): RunStreamState => {
  switch (action.type) {
    case 'reset':
      return initialRunStreamState
    case 'loaded':
      return {
        ...state,
        detail: action.detail,
        loading: false,
        loadError: undefined,
        refreshError: undefined,
      }
    case 'loadFailed':
      return { ...state, loading: false, loadError: action.message }
    case 'refreshFailed':
      return { ...state, refreshError: action.message }
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
  runId,
}: Readonly<{
  client: LiveRunClient
  runId: string
}>) {
  const mounted = useRef(false)
  const detailRef = useRef<RunDetailResponse | undefined>(undefined)
  const announcedOutcome = useRef<string | undefined>(undefined)
  const refreshSnapshot = useRef<() => Promise<void>>(async () => undefined)
  const [state, dispatch] = useReducer(runStreamReducer, initialRunStreamState)

  useEffect(() => {
    mounted.current = true
    detailRef.current = undefined
    announcedOutcome.current = undefined
    dispatch({ type: 'reset' })
    let active = true
    let pollTimer: ReturnType<typeof setTimeout> | undefined

    const applySnapshot = (next: RunDetailResponse) => {
      if (next.run.runId !== runId)
        throw new Error('Run snapshot identity does not match the route')
      detailRef.current = next
      dispatch({ type: 'loaded', detail: next })
      if (next.run.status === 'SUCCEEDED' || next.run.status === 'FAILED') {
        const outcomeKey = `${next.run.runId}:${next.run.status}`
        if (announcedOutcome.current !== outcomeKey) {
          announcedOutcome.current = outcomeKey
          announceWorkflowRunOutcomesChanged()
        }
      }
    }

    const loadSnapshot = async (initial: boolean) => {
      try {
        const next = await client.getRun(runId)
        if (active) applySnapshot(next)
      } catch (cause) {
        if (!active) return
        const message = cause instanceof Error ? cause.message : 'Run snapshot could not be loaded.'
        dispatch(initial ? { type: 'loadFailed', message } : { type: 'refreshFailed', message })
      }
    }
    refreshSnapshot.current = () => loadSnapshot(false)

    const poll = async () => {
      if (!active || terminalRunStatuses.has(detailRef.current?.run.status ?? 'PENDING')) return
      await loadSnapshot(false)
      if (!active || terminalRunStatuses.has(detailRef.current?.run.status ?? 'PENDING')) return
      pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
    }

    const start = async () => {
      await loadSnapshot(true)
      if (!active || terminalRunStatuses.has(detailRef.current?.run.status ?? 'PENDING')) return
      pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
    }
    void start()

    return () => {
      active = false
      mounted.current = false
      if (pollTimer !== undefined) clearTimeout(pollTimer)
    }
  }, [client, runId])

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
        dispatch({ type: 'loaded', detail: next })
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
}

const initialNodePanelState: NodePanelState = { selectedNodeId: undefined }

const updateNodePanel = (
  state: NodePanelState,
  update: Partial<NodePanelState>,
): NodePanelState => ({ ...state, ...update })

export function useRunNodePanel({
  defaultNodeId,
  runId,
}: Readonly<{
  defaultNodeId: string | undefined
  runId: string
}>) {
  const [state, update] = useReducer(updateNodePanel, initialNodePanelState)

  useEffect(() => update(initialNodePanelState), [runId])

  const open = useCallback((nodeId: string) => {
    update({ selectedNodeId: nodeId })
  }, [])

  return { selectedNodeId: state.selectedNodeId ?? defaultNodeId, open }
}
