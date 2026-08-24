export interface ExecutionPump {
  start(): void
  wake(): Promise<void>
  stop(): Promise<void>
}

export const createExecutionPump = (
  options: Readonly<{
    pollIntervalMs: number
    recoverExpired(): void
    cleanupTerminalRuns(): Promise<void>
    coordinator: Readonly<{ runOnce(): boolean }>
    worker: Readonly<{
      drain(): Promise<number>
      shutdown(): Promise<Readonly<{ status: 'cancelled' | 'unconfirmed' }>>
    }>
  }>,
): ExecutionPump => {
  if (!Number.isSafeInteger(options.pollIntervalMs) || options.pollIntervalMs < 10)
    throw new TypeError('Execution poll interval is invalid')
  let timer: ReturnType<typeof setInterval> | undefined
  let inFlight: Promise<void> | undefined
  let stopped = false

  const drainCoordinator = (): number => {
    let processed = 0
    while (options.coordinator.runOnce()) processed += 1
    return processed
  }

  const wake = (): Promise<void> => {
    if (stopped) return Promise.resolve()
    if (inFlight !== undefined) return inFlight
    inFlight = (async () => {
      options.recoverExpired()
      let coordinatorMessages = drainCoordinator()
      while (true) {
        const workerMessages = await options.worker.drain()
        coordinatorMessages = drainCoordinator()
        if (workerMessages === 0 && coordinatorMessages === 0) {
          await options.cleanupTerminalRuns()
          return
        }
      }
    })().finally(() => {
      inFlight = undefined
    })
    return inFlight
  }

  return {
    start() {
      if (stopped || timer !== undefined) return
      timer = setInterval(() => void wake(), options.pollIntervalMs)
      void wake()
    },
    wake,
    async stop() {
      if (stopped) return
      stopped = true
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      await options.worker.shutdown()
      await inFlight
    },
  }
}
