import { describe, expect, it, vi } from 'vitest'

import { createExecutionPump } from '../src/execution-pump.js'

describe('execution pump', () => {
  it('drains worker commands and coordinator facts until the durable queue is idle', async () => {
    const order: string[] = []
    let coordinatorCalls = 0
    let workerCalls = 0
    const pump = createExecutionPump({
      pollIntervalMs: 1_000,
      coordinator: {
        runOnce: vi.fn(() => {
          order.push('coordinator')
          coordinatorCalls += 1
          return coordinatorCalls === 2
        }),
      },
      worker: {
        drain: vi.fn(async () => {
          order.push('worker')
          workerCalls += 1
          return workerCalls === 1 ? 1 : 0
        }),
        shutdown: vi.fn(async () => ({ status: 'cancelled' })),
      },
    })

    await pump.wake()

    expect(order).toEqual([
      'coordinator',
      'worker',
      'coordinator',
      'coordinator',
      'worker',
      'coordinator',
    ])
    await pump.stop()
  })

  it('coalesces overlapping wake-ups into one execution loop', async () => {
    let release: (() => void) | undefined
    const worker = {
      drain: vi.fn(
        () =>
          new Promise<number>((resolve) => {
            release = () => resolve(0)
          }),
      ),
      shutdown: vi.fn(async () => ({ status: 'cancelled' as const })),
    }
    const pump = createExecutionPump({
      pollIntervalMs: 1_000,
      coordinator: { runOnce: () => false },
      worker,
    })

    const first = pump.wake()
    const second = pump.wake()
    expect(worker.drain).toHaveBeenCalledTimes(1)
    release?.()
    await Promise.all([first, second])
    expect(worker.drain).toHaveBeenCalledTimes(1)
    await pump.stop()
  })
})
