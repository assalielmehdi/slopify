import {
  AgentTraceStoreError,
  type FilesystemAgentTraceEventFeed,
} from '../../../index.js'
import type { Hono } from 'hono'
import { upgradeWebSocket } from 'hono/bun'

import { createLiveEventSocket } from './live-event-socket.js'

const cursor = (value: string | undefined): number => {
  if (value === undefined) return 0
  if (!/^\d+$/u.test(value)) {
    throw new AgentTraceStoreError('TRACE_REQUEST_INVALID', 'Trace event cursor is invalid')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new AgentTraceStoreError('TRACE_REQUEST_INVALID', 'Trace event cursor is invalid')
  }
  return parsed
}

const pathParameter = (value: string | undefined): string => {
  if (value === undefined) {
    throw new AgentTraceStoreError('TRACE_REQUEST_INVALID', 'Trace path is invalid')
  }
  return value
}

export const registerRunTraceEventRoutes = (
  app: Hono,
  traceEvents: FilesystemAgentTraceEventFeed,
): void => {
  app.get(
    '/api/runs/:runId/node-executions/:nodeExecutionId/trace/live',
    upgradeWebSocket((context) => {
      const attemptId = context.req.query('attemptId')
      if (attemptId === undefined) {
        throw new AgentTraceStoreError('TRACE_REQUEST_INVALID', 'Trace attempt ID is required')
      }
      const controller = new AbortController()
      const events = traceEvents.subscribe({
        runId: pathParameter(context.req.param('runId')),
        nodeExecutionId: pathParameter(context.req.param('nodeExecutionId')),
        attemptId,
        afterSequence: cursor(context.req.query('afterSequence')),
        signal: controller.signal,
      })
      return createLiveEventSocket({
        events,
        controller,
        error: (cause) =>
          cause instanceof AgentTraceStoreError
            ? { code: cause.code, message: cause.message }
            : { code: 'TRACE_EVENT_STREAM_FAILED', message: 'Trace event stream failed' },
      })
    }),
  )
}
