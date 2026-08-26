export interface ExecutionPump {
  start(): void
  wake(): Promise<void>
  stop(): Promise<void>
}

export type FilesystemExecutionPump = ExecutionPump

export const createFilesystemExecutionPump = (
  options: Readonly<{
    pollIntervalMs: number
    recovery: Readonly<{ recover(): Promise<unknown> }>
    heartbeat(): Promise<void>
    onError?: (error: unknown) => void
  }>,
): FilesystemExecutionPump => {
  if (!Number.isSafeInteger(options.pollIntervalMs) || options.pollIntervalMs < 10) {
    throw new TypeError('Execution poll interval is invalid')
  }
  let timer: ReturnType<typeof setInterval> | undefined
  let inFlight: Promise<void> | undefined
  let stopped = false

  const wake = (): Promise<void> => {
    if (stopped) return Promise.resolve()
    if (inFlight !== undefined) return inFlight
    inFlight = (async () => {
      await options.recovery.recover()
      await options.heartbeat()
    })().finally(() => {
      inFlight = undefined
    })
    return inFlight
  }

  const wakeInBackground = (): void => {
    void wake().catch((error) => options.onError?.(error))
  }

  return {
    start() {
      if (stopped || timer !== undefined) return
      timer = setInterval(wakeInBackground, options.pollIntervalMs)
      wakeInBackground()
    },
    wake,
    async stop() {
      if (stopped) return
      stopped = true
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      await inFlight
    },
  }
}
