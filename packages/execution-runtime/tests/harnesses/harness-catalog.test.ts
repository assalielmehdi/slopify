import { describe, expect, it, vi } from 'vitest'

import { HarnessCatalogError, createHarnessCatalog } from '../../src/index.js'

const availablePi = {
  harnessId: 'pi',
  name: 'Pi',
  description: 'Run workflows with the Pi CLI configured on this machine.',
  availability: 'AVAILABLE' as const,
  executablePath: '/usr/local/bin/pi',
  version: '0.84.2',
  installHref: 'https://pi.dev/',
  installLabel: 'Install Pi',
  models: [
    {
      id: 'openai-codex/gpt-5.4',
      name: 'openai-codex/gpt-5.4',
      thinkingLevels: ['off', 'low', 'medium', 'high'] as const,
    },
  ],
}

describe('harness catalog', () => {
  it('discovers registered adapters on every read instead of persisting host state', async () => {
    const inspect = vi.fn(async () => availablePi)
    const catalog = createHarnessCatalog({ inspectors: [{ harnessId: 'pi', inspect }] })

    await expect(catalog.list()).resolves.toEqual([availablePi])
    await expect(catalog.list()).resolves.toEqual([availablePi])
    expect(inspect).toHaveBeenCalledTimes(2)
  })

  it('requires an available harness and a configured model when one is selected', async () => {
    const catalog = createHarnessCatalog({
      inspectors: [{ harnessId: 'pi', inspect: async () => availablePi }],
    })

    await expect(catalog.requireAvailable('pi', 'openai-codex/gpt-5.4', 'high')).resolves.toEqual(
      availablePi,
    )
    await expect(
      catalog.requireAvailable('pi', 'openai-codex/gpt-5.4', 'max'),
    ).rejects.toMatchObject({ code: 'HARNESS_THINKING_UNAVAILABLE' })
    await expect(catalog.requireAvailable('pi', 'missing/model')).rejects.toMatchObject({
      code: 'HARNESS_MODEL_UNAVAILABLE',
    } satisfies Partial<HarnessCatalogError>)
    await expect(catalog.requireAvailable('codex')).rejects.toMatchObject({
      code: 'HARNESS_NOT_FOUND',
    } satisfies Partial<HarnessCatalogError>)
  })

  it('preserves the adapter-provided installation guidance when a harness is unavailable', async () => {
    const catalog = createHarnessCatalog({
      inspectors: [
        {
          harnessId: 'pi',
          inspect: async () => ({
            harnessId: 'pi',
            name: 'Pi',
            description: availablePi.description,
            availability: 'UNAVAILABLE' as const,
            unavailableReason: 'Pi was not found in PATH.',
            installHref: 'https://pi.dev/',
            installLabel: 'Install Pi',
            models: [],
          }),
        },
      ],
    })

    await expect(catalog.requireAvailable('pi')).rejects.toMatchObject({
      code: 'HARNESS_UNAVAILABLE',
      descriptor: expect.objectContaining({ installHref: 'https://pi.dev/' }),
    } satisfies Partial<HarnessCatalogError>)
  })
})
