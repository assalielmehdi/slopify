import { describe, expect, it, vi } from 'vitest'

import type { HarnessCatalog } from '@slopify/execution-runtime'

import { createApiApp } from '../src/app.js'

describe('harness catalog API', () => {
  it('returns the live host harness catalog without private host configuration', async () => {
    const harnesses: HarnessCatalog = {
      list: vi.fn(async () => [
        {
          harnessId: 'pi',
          name: 'Pi',
          description: 'Run workflows with the Pi CLI configured on this machine.',
          availability: 'AVAILABLE',
          executablePath: '/opt/homebrew/bin/pi',
          version: '0.84.2',
          installHref: 'https://pi.dev/',
          installLabel: 'Install Pi',
          models: [],
        },
      ]),
      get: vi.fn(),
      requireAvailable: vi.fn(),
    }
    const response = await createApiApp({ harnesses }).request('/api/harnesses')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      harnesses: [
        expect.objectContaining({
          harnessId: 'pi',
          availability: 'AVAILABLE',
          version: '0.84.2',
        }),
      ],
    })
    expect(harnesses.list).toHaveBeenCalledOnce()
  })

  it('does not expose a harness route when the catalog is unavailable', async () => {
    const response = await createApiApp({}).request('/api/harnesses')

    expect(response.status).toBe(404)
  })
})
