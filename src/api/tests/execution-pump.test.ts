import { describe, expect, it, vi } from 'vitest'

import { createFilesystemExecutionPump } from '../src/platform/runtime/execution-pump.js'

describe('filesystem execution pump', () => {
  it('coalesces journal recovery cycles and heartbeats after durable work settles', async () => {
    const order: string[] = []
    let finishRecovery: (() => void) | undefined
    const recovery = {
      recover: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            order.push('recover')
            finishRecovery = resolve
          }),
      ),
    }
    const pump = createFilesystemExecutionPump({
      pollIntervalMs: 1_000,
      recovery,
      heartbeat: vi.fn(async () => {
        order.push('heartbeat')
      }),
    })

    const first = pump.wake()
    const second = pump.wake()
    expect(recovery.recover).toHaveBeenCalledOnce()
    finishRecovery?.()
    await Promise.all([first, second])

    expect(order).toEqual(['recover', 'heartbeat'])
    await pump.stop()
  })
})
