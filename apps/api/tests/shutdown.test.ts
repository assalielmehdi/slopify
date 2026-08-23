import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createShutdownCoordinator,
  registerShutdownSignals,
  type ShutdownProcess,
  type ShutdownServer,
} from '../src/shutdown.js'

afterEach(() => {
  vi.useRealTimers()
})

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('API graceful shutdown', () => {
  it('stops admissions before cancellation and closes SQLite after work and HTTP drain', async () => {
    const order: string[] = []
    const cancellation = deferred()
    let serverClosed!: () => void
    const server: ShutdownServer = {
      stop(force) {
        order.push(force === true ? 'server.stop(true)' : 'server.stop')
        return new Promise<void>((resolve) => {
          serverClosed = resolve
        })
      },
    }
    let databaseOpen = true
    const coordinator = createShutdownCoordinator({
      server,
      runs: { stopAdmissions: () => order.push('runs.stopAdmissions') },
      cancellation: {
        cancelActive: async () => {
          order.push('cancellation.cancelActive')
          await cancellation.promise
        },
      },
      database: {
        get isOpen() {
          return databaseOpen
        },
        close() {
          order.push('database.close')
          databaseOpen = false
        },
      },
      gracePeriodMs: 1_000,
    })

    const shutdown = coordinator.shutdown('SIGTERM')

    expect(order).toEqual(['runs.stopAdmissions', 'server.stop', 'cancellation.cancelActive'])
    expect(databaseOpen).toBe(true)

    cancellation.resolve()
    serverClosed()
    await expect(shutdown).resolves.toEqual({ signal: 'SIGTERM', forced: false })
    expect(order).toEqual([
      'runs.stopAdmissions',
      'server.stop',
      'cancellation.cancelActive',
      'database.close',
    ])

    await coordinator.shutdown('SIGINT')
    expect(order.filter((entry) => entry === 'runs.stopAdmissions')).toHaveLength(1)
  })

  it('forces the server closed and flushes SQLite at the configured deadline', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    let databaseOpen = true
    const coordinator = createShutdownCoordinator({
      server: {
        stop: async (force) => {
          order.push(force === true ? 'server.stop(true)' : 'server.stop')
          if (force !== true) await new Promise(() => undefined)
        },
      },
      runs: { stopAdmissions: () => order.push('runs.stopAdmissions') },
      cancellation: {
        cancelActive: async () => {
          order.push('cancellation.cancelActive')
          await new Promise(() => undefined)
        },
      },
      database: {
        get isOpen() {
          return databaseOpen
        },
        close() {
          order.push('database.close')
          databaseOpen = false
        },
      },
      gracePeriodMs: 25,
    })

    const shutdown = coordinator.shutdown('SIGINT')
    await vi.advanceTimersByTimeAsync(25)

    await expect(shutdown).resolves.toEqual({ signal: 'SIGINT', forced: true })
    expect(order).toEqual([
      'runs.stopAdmissions',
      'server.stop',
      'cancellation.cancelActive',
      'server.stop(true)',
      'database.close',
    ])
  })

  it('wires SIGTERM and SIGINT to one shutdown and sets the process exit code', async () => {
    const target = Object.assign(new EventEmitter(), { exitCode: undefined }) as ShutdownProcess
    const shutdown = vi.fn(async (signal: 'SIGINT' | 'SIGTERM') => ({
      signal,
      forced: false,
    }))
    const removeListeners = registerShutdownSignals({ coordinator: { shutdown }, target })

    target.emit('SIGINT')
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalledWith('SIGINT'))
    expect(target.exitCode).toBe(0)

    removeListeners()
    expect(target.listenerCount('SIGINT')).toBe(0)
    expect(target.listenerCount('SIGTERM')).toBe(0)
  })
})
