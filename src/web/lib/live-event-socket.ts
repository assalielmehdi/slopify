import { LiveEventEnvelopeSchema } from '@slopify/shared'

export interface LiveEventSocketHandlers {
  readonly onDisconnect: () => void
  readonly onEvent: (event: unknown) => void
  readonly onInvalidEvent: (cause: unknown) => void
  readonly onOpen: () => void
}

export type LiveEventSubscription = (
  url: () => string,
  handlers: LiveEventSocketHandlers,
) => () => void

const RECONNECT_DELAY_MS = 250

const serverError = (code: string, message: string): Error =>
  Object.assign(new Error(message), { code })

export const connectLiveEventSocket: LiveEventSubscription = (url, handlers) => {
  let closed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let socket: WebSocket | undefined

  const open = (): void => {
    if (closed) return
    const next = new WebSocket(url())
    socket = next
    next.addEventListener('open', () => {
      if (!closed && socket === next) handlers.onOpen()
    })
    next.addEventListener('message', (message) => {
      try {
        if (typeof message.data !== 'string') throw new Error('Live event data is invalid')
        const envelope = LiveEventEnvelopeSchema.parse(JSON.parse(message.data))
        if (envelope.type === 'ERROR') {
          handlers.onInvalidEvent(serverError(envelope.error.code, envelope.error.message))
          return
        }
        handlers.onEvent(envelope.event)
      } catch (cause) {
        handlers.onInvalidEvent(cause)
      }
    })
    next.addEventListener('close', () => {
      if (closed || socket !== next) return
      handlers.onDisconnect()
      reconnectTimer = setTimeout(open, RECONNECT_DELAY_MS)
    })
  }

  open()
  return () => {
    closed = true
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
    socket?.close()
  }
}

export const webSocketUrl = (
  origin: string,
  path: string,
  parameters: Readonly<Record<string, string | number>>,
): string => {
  const url = new URL(path, origin)
  if (url.protocol === 'http:') url.protocol = 'ws:'
  else if (url.protocol === 'https:') url.protocol = 'wss:'
  else throw new Error('Live event origin must use HTTP or HTTPS')
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, String(value))
  return url.toString()
}
