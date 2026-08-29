import { describe, expect, it, vi } from 'vitest'

import type { AgentExecutor } from '@slopify/shared'
import { createHarnessService } from '../../../src/index.js'

const executor = (): AgentExecutor => ({
  execute: async function* () {
    return
  },
  cancel: vi.fn(async () => ({ status: 'cancelled' })),
})

describe('harness service', () => {
  it('registers a harness variant without changing discovery or execution APIs', async () => {
    const local = executor()
    const service = createHarnessService({
      adapters: [
        {
          inspector: {
            harnessId: 'local',
            inspect: async () => ({
              harnessId: 'local',
              name: 'Local test harness',
              description: 'Runs agents through a test adapter.',
              availability: 'AVAILABLE' as const,
              executablePath: '/usr/local/bin/local-harness',
              version: '1.0.0',
              installHref: 'https://example.com/local-harness',
              installLabel: 'Install local harness',
              models: [],
            }),
          },
          executor: local,
        },
      ],
    })

    await expect(service.list()).resolves.toMatchObject([{ harnessId: 'local' }])
    expect(service.resolveExecutor('local')).toBe(local)
    expect(service.resolveExecutor('unsupported')).toBeUndefined()
  })
})
