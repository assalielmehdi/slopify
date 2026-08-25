import { ResourceChangeEventSchema, type ResourceChangeEvent } from '@slopify/contracts'

export const resourceEventStreamUrl = '/api/resource-events'

export interface ResourceEventSource {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void
  close(): void
}

export interface ResourceEventStreamHandlers {
  readonly onDisconnect: () => void
  readonly onEvent: (event: ResourceChangeEvent) => void
  readonly onInvalidEvent: (cause: unknown) => void
  readonly onOpen: () => void
  readonly onReconcile: () => void | Promise<void>
}

export interface ResourceEventStreamOptions {
  readonly createEventSource?: (url: string) => ResourceEventSource
  readonly reconcileIntervalMs?: number
}

export const parseResourceChangeEvent = (data: string): ResourceChangeEvent =>
  ResourceChangeEventSchema.parse(JSON.parse(data))

export const connectResourceEventStream = (
  handlers: ResourceEventStreamHandlers,
  options: ResourceEventStreamOptions = {},
): (() => void) => {
  const reconcileIntervalMs = options.reconcileIntervalMs ?? 30_000
  if (
    !Number.isSafeInteger(reconcileIntervalMs) ||
    reconcileIntervalMs < 1 ||
    reconcileIntervalMs > 3_600_000
  ) {
    throw new TypeError('reconcileIntervalMs must be an integer from 1 to 3600000')
  }
  const createEventSource =
    options.createEventSource ??
    ((url) =>
      typeof EventSource === 'undefined'
        ? { addEventListener: () => undefined, close: () => undefined }
        : new EventSource(url))
  const source = createEventSource(resourceEventStreamUrl)
  const reconcile = (): void => {
    try {
      void Promise.resolve(handlers.onReconcile()).catch(handlers.onInvalidEvent)
    } catch (cause) {
      handlers.onInvalidEvent(cause)
    }
  }

  source.addEventListener('open', () => {
    handlers.onOpen()
    reconcile()
  })
  source.addEventListener('error', handlers.onDisconnect)
  source.addEventListener('resource-change', (message) => {
    try {
      if (!(message instanceof MessageEvent) || typeof message.data !== 'string') {
        throw new Error('Resource event data is invalid')
      }
      handlers.onEvent(parseResourceChangeEvent(message.data))
    } catch (cause) {
      handlers.onInvalidEvent(cause)
    }
  })
  const reconciliationTimer = setInterval(reconcile, reconcileIntervalMs)

  return () => {
    clearInterval(reconciliationTimer)
    source.close()
  }
}

export type ConnectResourceEventStream = typeof connectResourceEventStream
