export type ShutdownSignal = 'SIGINT' | 'SIGTERM'

export interface ShutdownServer {
  stop(closeActiveConnections?: boolean): Promise<void>
}

export interface ShutdownProcess {
  exitCode: number | string | undefined
  on(event: ShutdownSignal, listener: () => void): unknown
  off(event: ShutdownSignal, listener: () => void): unknown
  emit(event: ShutdownSignal): boolean
  listenerCount(event: ShutdownSignal): number
}

export interface ShutdownResult {
  readonly signal: ShutdownSignal
  readonly forced: boolean
}

export interface ShutdownCoordinator {
  shutdown(signal: ShutdownSignal): Promise<ShutdownResult>
}

export interface CreateShutdownCoordinatorOptions {
  readonly server: ShutdownServer
  readonly runs: Readonly<{ stopAdmissions(): void }>
  readonly cancellation: Readonly<{ cancelActive(reason?: string): Promise<unknown> }>
  readonly execution?: Readonly<{ stop(): Promise<void> }>
  readonly database: Readonly<{ readonly isOpen: boolean; close(): void }>
  readonly gracePeriodMs: number
}

export const createShutdownCoordinator = (
  options: CreateShutdownCoordinatorOptions,
): ShutdownCoordinator => {
  if (!Number.isSafeInteger(options.gracePeriodMs) || options.gracePeriodMs < 1) {
    throw new RangeError('Shutdown grace period must be a positive safe integer')
  }
  let inFlight: Promise<ShutdownResult> | undefined

  const closeDatabase = (): void => {
    if (options.database.isOpen) options.database.close()
  }

  return {
    shutdown(signal) {
      if (inFlight !== undefined) return inFlight

      options.runs.stopAdmissions()
      const serverStopped = options.server.stop().catch(() => undefined)

      const graceful = (async (): Promise<ShutdownResult> => {
        try {
          await options.cancellation.cancelActive(`Process received ${signal}`)
        } catch {
          // Shutdown still has to close persistence and exit within its deadline.
        }
        await options.execution?.stop()
        await serverStopped
        closeDatabase()
        return { signal, forced: false }
      })()

      let deadline: ReturnType<typeof setTimeout>
      const forced = new Promise<ShutdownResult>((resolve) => {
        deadline = setTimeout(() => {
          void options.server.stop(true).then(
            () => {
              closeDatabase()
              resolve({ signal, forced: true })
            },
            () => {
              closeDatabase()
              resolve({ signal, forced: true })
            },
          )
        }, options.gracePeriodMs)
      })

      inFlight = Promise.race([graceful, forced]).finally(() => clearTimeout(deadline))
      return inFlight
    },
  }
}

export interface CreateFilesystemShutdownCoordinatorOptions {
  readonly server: ShutdownServer
  readonly runs: Readonly<{ stopAdmissions(): void }>
  readonly activeRuns: () => Promise<
    readonly Readonly<{ readonly workflowId: string; readonly runId: string }>[]
  >
  readonly cancellation: Readonly<{
    cancel(input: {
      readonly workflowId: string
      readonly runId: string
      readonly reason?: string
    }): Promise<unknown>
  }>
  readonly execution: Readonly<{ stop(): Promise<void> }>
  readonly ownership: Readonly<{ release(): Promise<void> }>
  readonly gracePeriodMs: number
}

export const createFilesystemShutdownCoordinator = (
  options: CreateFilesystemShutdownCoordinatorOptions,
): ShutdownCoordinator => {
  if (!Number.isSafeInteger(options.gracePeriodMs) || options.gracePeriodMs < 1) {
    throw new RangeError('Shutdown grace period must be a positive safe integer')
  }
  let inFlight: Promise<ShutdownResult> | undefined

  return {
    shutdown(signal) {
      if (inFlight !== undefined) return inFlight
      options.runs.stopAdmissions()
      const serverStopped = options.server.stop().catch(() => undefined)
      const graceful = (async (): Promise<ShutdownResult> => {
        let cancellationConfirmed = true
        for (const run of await options.activeRuns()) {
          try {
            await options.cancellation.cancel({ ...run, reason: `Process received ${signal}` })
          } catch {
            cancellationConfirmed = false
          }
        }
        await options.execution.stop()
        await serverStopped
        if (!cancellationConfirmed) return { signal, forced: true }
        await options.ownership.release()
        return { signal, forced: false }
      })()

      let deadline: ReturnType<typeof setTimeout>
      const forced = new Promise<ShutdownResult>((resolve) => {
        deadline = setTimeout(() => {
          void options.server.stop(true).then(
            () => resolve({ signal, forced: true }),
            () => resolve({ signal, forced: true }),
          )
        }, options.gracePeriodMs)
      })
      inFlight = Promise.race([graceful, forced]).finally(() => clearTimeout(deadline))
      return inFlight
    },
  }
}

export const registerShutdownSignals = (input: {
  readonly coordinator: ShutdownCoordinator
  readonly target?: ShutdownProcess
}): (() => void) => {
  const target = input.target ?? (process as ShutdownProcess)
  let removed = false
  const handlers: Record<ShutdownSignal, () => void> = {
    SIGINT: () => handle('SIGINT'),
    SIGTERM: () => handle('SIGTERM'),
  }

  const removeListeners = (): void => {
    if (removed) return
    removed = true
    target.off('SIGINT', handlers.SIGINT)
    target.off('SIGTERM', handlers.SIGTERM)
  }

  function handle(signal: ShutdownSignal): void {
    void input.coordinator.shutdown(signal).then(
      (result) => {
        target.exitCode = result.forced ? 1 : 0
        removeListeners()
      },
      () => {
        target.exitCode = 1
        removeListeners()
      },
    )
  }

  target.on('SIGINT', handlers.SIGINT)
  target.on('SIGTERM', handlers.SIGTERM)
  return removeListeners
}
