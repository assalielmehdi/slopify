'use client'

import { ElapsedTime } from '@/components/runs/elapsed-time'
import { RunNodeDetailsPanel } from '@/components/runs/run-node-details-panel'
import { RunStatusBadge } from '@/components/runs/run-status'
import {
  type LiveRunClient,
  useLiveRunStream,
  useRunNodePanel,
} from '@/components/runs/use-live-run'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { WorkflowCanvas } from '@/components/workflow/workflow-canvas'
import { WorkflowWorkspace } from '@/components/workflow/workflow-workspace'
import { createApiClient } from '@/lib/api-client'
import { latestExecutions, nodeStatusesFrom, runStatusFrom } from '@/lib/live-run'
import { formatTimestamp } from '@/lib/run-format'
import { displayRunId } from '@/lib/run-id'

const defaultClient = createApiClient()

export interface LiveRunProps {
  readonly client?: LiveRunClient
  readonly runId: string
}

export function LiveRun({ client = defaultClient, runId }: LiveRunProps) {
  const stream = useLiveRunStream({ client, runId })
  const defaultNodeId = (() => {
    if (stream.detail === undefined) return undefined
    const defaultStatuses = nodeStatusesFrom(stream.detail)
    const nodes = stream.detail.run.workflowSnapshot.nodes
    return (
      nodes.find(({ id }) => defaultStatuses[id] === 'RUNNING')?.id ??
      nodes.find(({ id }) => defaultStatuses[id] === 'PENDING')?.id ??
      nodes[0]?.id
    )
  })()
  const panel = useRunNodePanel({
    defaultNodeId,
    runId,
  })

  if (stream.loading)
    return <p className="text-xs text-muted-foreground">Loading run {displayRunId(runId)}…</p>
  if (stream.detail === undefined) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Run unavailable</AlertTitle>
        <AlertDescription>{stream.loadError ?? 'Run could not be loaded.'}</AlertDescription>
      </Alert>
    )
  }

  const detail = stream.detail
  const status = runStatusFrom(detail.run.status, detail.events)
  const statuses = nodeStatusesFrom(detail)
  const cancellationRequested = detail.events.some(({ type }) => type === 'RUN_CANCEL_REQUESTED')
  const activeAgentIds: string[] = []
  for (const node of detail.run.workflowSnapshot.nodes) {
    if (statuses[node.id] === 'PENDING' || statuses[node.id] === 'RUNNING') {
      activeAgentIds.push(node.id)
    }
  }
  const cancellable = status === 'RUNNING' && activeAgentIds.length > 0 && !cancellationRequested
  const agentNodes = detail.run.workflowSnapshot.nodes
  const currentAgentId =
    activeAgentIds.find((nodeId) => statuses[nodeId] === 'RUNNING') ?? activeAgentIds[0]
  const selectedNode = agentNodes.find(({ id }) => id === panel.selectedNodeId)
  const selectedExecution =
    selectedNode === undefined
      ? undefined
      : latestExecutions(detail.nodeExecutions).get(selectedNode.id)

  const graph = (
    <div className="relative h-full min-h-0 min-w-0">
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start gap-x-3 gap-y-2">
        <div
          aria-label="Run timing"
          className="flex max-w-full shrink-0 flex-col text-xs/4 whitespace-nowrap text-muted-foreground tabular-nums"
        >
          <span>Started {formatTimestamp(detail.run.startedAt)}</span>
          <span>
            Took{' '}
            <ElapsedTime
              completedAt={detail.run.completedAt}
              running={status === 'RUNNING'}
              startedAt={detail.run.startedAt}
            />
          </span>
        </div>
        <div
          aria-label="Run status"
          className="pointer-events-auto ml-auto flex shrink-0 items-center gap-2"
        >
          <RunStatusBadge status={status} />
          {cancellable || stream.cancelling ? (
            <Button
              disabled={stream.cancelling}
              onClick={() => void stream.cancel(cancellable)}
              size="sm"
              variant="destructive"
            >
              {stream.cancelling ? 'Cancelling…' : 'Cancel run'}
            </Button>
          ) : null}
        </div>
      </div>
      <WorkflowCanvas
        onNodeSelect={panel.open}
        recentRunStatuses={statuses}
        selectedNodeId={panel.selectedNodeId ?? currentAgentId ?? agentNodes[0]?.id}
        workflow={detail.run.workflowSnapshot}
      />
    </div>
  )

  const details =
    selectedNode === undefined ? (
      <aside
        aria-label="Run agent details"
        className="grid h-full place-items-center p-6 text-center"
        data-layout="workspace"
      >
        <p className="max-w-sm text-sm/5 text-muted-foreground">
          Select an agent in the workflow graph to inspect its captured execution.
        </p>
      </aside>
    ) : (
      <RunNodeDetailsPanel
        execution={selectedExecution}
        node={selectedNode}
        status={statuses[selectedNode.id] ?? 'PENDING'}
      />
    )

  return (
    <section className="relative flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden px-6 pb-6">
      {stream.refreshError === undefined ? null : (
        <Alert className="shrink-0" variant="destructive">
          <AlertTitle>Run updates delayed</AlertTitle>
          <AlertDescription>{stream.refreshError}</AlertDescription>
        </Alert>
      )}
      {stream.cancelError === undefined ? null : (
        <Alert className="shrink-0" variant="destructive">
          <AlertTitle>Run not cancelled</AlertTitle>
          <AlertDescription>{stream.cancelError}</AlertDescription>
        </Alert>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <WorkflowWorkspace details={details} graph={graph} workflow={detail.run.workflowSnapshot} />
      </div>
    </section>
  )
}
