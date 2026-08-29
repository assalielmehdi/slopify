import { RunEventFeedError, type FilesystemRunEventFeed } from '../../../index.js'
import type { Hono } from 'hono'
import { upgradeWebSocket } from 'hono/bun'
import { streamSSE } from 'hono/streaming'

import { createLiveEventSocket } from './live-event-socket.js'

const cursor = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) {
    throw new RunEventFeedError('RUN_EVENT_CURSOR_INVALID', 'Run event cursor is invalid')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new RunEventFeedError('RUN_EVENT_CURSOR_INVALID', 'Run event cursor is invalid')
  }
  return parsed
}

const runId = (value: string | undefined): string => {
  if (value === undefined) {
    throw new RunEventFeedError('RUN_NOT_FOUND', 'Run was not found')
  }
  return value
}

export const registerRunEventRoutes = (app: Hono, eventFeed: FilesystemRunEventFeed): void => {
  app.get(
    '/api/runs/:runId/live',
    upgradeWebSocket((context) => {
      const controller = new AbortController()
      const events = eventFeed.subscribe({
        runId: runId(context.req.param('runId')),
        afterSequence: cursor(context.req.query('afterSequence')) ?? 0,
        signal: controller.signal,
      })
      return createLiveEventSocket({
        events,
        controller,
        error: (cause) =>
          cause instanceof RunEventFeedError
            ? { code: cause.code, message: cause.message }
            : { code: 'RUN_EVENT_STREAM_FAILED', message: 'Run event stream failed' },
      })
    }),
  )

  app.get('/api/runs/:runId/events', (context) => {
    const queryCursor = cursor(context.req.query('afterSequence'))
    const headerCursor = cursor(context.req.header('Last-Event-ID'))
    if (queryCursor !== undefined && headerCursor !== undefined && queryCursor !== headerCursor) {
      throw new RunEventFeedError('RUN_EVENT_CURSOR_INVALID', 'Run event cursors must not conflict')
    }
    const controller = new AbortController()
    const events = eventFeed.subscribe({
      runId: runId(context.req.param('runId')),
      afterSequence: queryCursor ?? headerCursor ?? 0,
      signal: controller.signal,
    })

    return streamSSE(context, async (stream) => {
      stream.onAbort(() => controller.abort())
      try {
        for await (const event of events) {
          await stream.writeSSE({
            id: String(event.sequence),
            event: 'run-event',
            data: JSON.stringify(event),
          })
        }
        if (!stream.aborted) await stream.close()
      } finally {
        controller.abort()
      }
    })
  })
}
