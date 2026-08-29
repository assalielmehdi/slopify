import { LiveEventEnvelopeSchema } from '@slopify/shared'
import type { WSEvents } from 'hono/ws'

interface LiveEventError {
  readonly code: string
  readonly message: string
}

export const createLiveEventSocket = <Event>(options: {
  readonly events: AsyncIterable<Event>
  readonly controller: AbortController
  readonly error: (cause: unknown) => LiveEventError
}): WSEvents => ({
  onOpen(_event, socket) {
    void (async () => {
      try {
        for await (const event of options.events) {
          if (options.controller.signal.aborted || socket.readyState !== 1) return
          socket.send(JSON.stringify(LiveEventEnvelopeSchema.parse({ type: 'EVENT', event })))
        }
        if (socket.readyState === 1) socket.close(1000, 'Complete')
      } catch (cause) {
        if (options.controller.signal.aborted) return
        if (socket.readyState === 1) {
          socket.send(
            JSON.stringify(
              LiveEventEnvelopeSchema.parse({ type: 'ERROR', error: options.error(cause) }),
            ),
          )
          socket.close(1011, 'Live event stream failed')
        }
      }
    })()
  },
  onClose() {
    options.controller.abort()
  },
  onError() {
    options.controller.abort()
  },
})
