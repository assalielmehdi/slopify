import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createFilesystemShutdownCoordinator,
  registerShutdownSignals,
  type ShutdownProcess,
} from '../src/shutdown.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('filesystem API graceful shutdown', () => {
  it('stops admissions, cancels captured active runs, drains, then releases ownership', async () => {
    const order: string[] = []
    const coordinator = createFilesystemShutdownCoordinator({
      server: { stop: async () => void order.push('server.stop') },
      runs: { stopAdmissions: () => order.push('runs.stopAdmissions') },
      activeRuns: async () => [
        { workflowId: 'workflow-01', runId: 'run-01' },
        { workflowId: 'workflow-02', runId: 'run-02' },
      ],
      cancellation: {
        cancel: async ({ runId }) => void order.push(`cancel:${runId}`),
      },
      execution: { stop: async () => void order.push('execution.stop') },
      ownership: { release: async () => void order.push('ownership.release') },
      gracePeriodMs: 1_000,
    })

    await expect(coordinator.shutdown('SIGTERM')).resolves.toEqual({
      signal: 'SIGTERM',
      forced: false,
    })
    expect(order).toEqual([
      'runs.stopAdmissions',
      'server.stop',
      'cancel:run-01',
      'cancel:run-02',
      'execution.stop',
      'ownership.release',
    ])
  })

  it('keeps ownership when the deadline wins over unresolved execution', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const coordinator = createFilesystemShutdownCoordinator({
      server: {
        stop: async (force) => {
          order.push(force === true ? 'server.stop(true)' : 'server.stop')
          if (force !== true) await new Promise(() => undefined)
        },
      },
      runs: { stopAdmissions: () => order.push('runs.stopAdmissions') },
      activeRuns: async () => [],
      cancellation: { cancel: async () => undefined },
      execution: {
        stop: async () => {
          order.push('execution.stop')
          await new Promise(() => undefined)
        },
      },
      ownership: { release: async () => void order.push('ownership.release') },
      gracePeriodMs: 25,
    })

    const shutdown = coordinator.shutdown('SIGINT')
    await vi.advanceTimersByTimeAsync(25)

    await expect(shutdown).resolves.toEqual({ signal: 'SIGINT', forced: true })
    expect(order).toEqual([
      'runs.stopAdmissions',
      'server.stop',
      'execution.stop',
      'server.stop(true)',
    ])
  })
})

describe('shutdown signals', () => {
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
