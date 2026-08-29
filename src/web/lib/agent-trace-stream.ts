import { AgentTraceEventSchema, RunIdSchema, type AgentTraceEvent } from '@slopify/shared'

import { webSocketUrl } from '@/lib/live-event-socket'

const pathIdentifier = (value: string): string => {
  if (value.length === 0 || value.length > 512) throw new Error('Trace identifier is invalid')
  return value
}

export const parseAgentTraceEvent = (value: unknown): AgentTraceEvent =>
  AgentTraceEventSchema.parse(value)

export const agentTraceLiveEventUrl = (
  origin: string,
  runId: string,
  nodeExecutionId: string,
  attemptId: string,
  afterSequence: number,
): string =>
  webSocketUrl(
    origin,
    `/api/runs/${encodeURIComponent(RunIdSchema.parse(runId))}/node-executions/${encodeURIComponent(pathIdentifier(nodeExecutionId))}/trace/live`,
    { attemptId: pathIdentifier(attemptId), afterSequence },
  )
