import type { NodeExecutionStatus, RunStatus } from '@slopify/contracts'

import type { RunDetailResponse } from '@/lib/api-client'
import type { RunEvent } from '@/lib/event-stream'

export type NodeExecution = RunDetailResponse['nodeExecutions'][number]

export const terminalRunStatuses = new Set<RunStatus>(['SUCCEEDED', 'FAILED', 'CANCELLED'])

export const lastRunEventSequence = (events: readonly RunEvent[]): number =>
  events.at(-1)?.sequence ?? 0

export const runStatusFrom = (
  snapshotStatus: RunStatus,
  events: readonly RunEvent[],
): RunStatus => {
  if (terminalRunStatuses.has(snapshotStatus)) return snapshotStatus
  let status = snapshotStatus
  for (const event of events) {
    if (event.type === 'RUN_SUCCEEDED') status = 'SUCCEEDED'
    if (event.type === 'RUN_FAILED') status = 'FAILED'
    if (event.type === 'RUN_CANCELLED') status = 'CANCELLED'
  }
  return status
}

export const latestExecutions = (
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

export const nodeStatusesFrom = (
  detail: RunDetailResponse,
): Readonly<Record<string, NodeExecutionStatus>> => {
  const statuses: Record<string, NodeExecutionStatus> = Object.fromEntries(
    detail.run.workflowSnapshot.nodes.map((node) => [node.id, 'PENDING' as const]),
  )
  for (const execution of latestExecutions(detail.nodeExecutions).values()) {
    statuses[execution.nodeId] = execution.status
  }
  return statuses
}
