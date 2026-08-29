import { describe, expect, it, vi } from 'vitest'

import {
  SettingsRecordSchema,
  SettingsRevisionSchema,
  SettingsStoreError,
  createSettingsService,
  type SettingsStore,
} from '../../../src/index.js'

const revision = SettingsRevisionSchema.parse('a'.repeat(64))
const current = SettingsRecordSchema.parse({
  schemaVersion: 1,
  appearance: { theme: 'system' },
  git: { connections: [] },
})

describe('settings service', () => {
  it('updates appearance through the persistence port without replacing other settings', async () => {
    const write = vi.fn<SettingsStore['write']>(async ({ value }) => ({ value, revision }))
    const service = createSettingsService({
      settings: {
        read: async () => ({ value: current, revision }),
        write,
      },
    })

    await expect(
      service.updateAppearance({ appearance: { theme: 'dark' }, expectedRevision: revision }),
    ).resolves.toMatchObject({ value: { appearance: { theme: 'dark' }, git: current.git } })
    expect(write).toHaveBeenCalledWith({
      value: { ...current, appearance: { theme: 'dark' } },
      expectedRevision: revision,
    })
  })

  it('rejects a stale revision before writing', async () => {
    const write = vi.fn<SettingsStore['write']>()
    const service = createSettingsService({
      settings: {
        read: async () => ({ value: current, revision }),
        write,
      },
    })

    await expect(
      service.updateAppearance({ appearance: { theme: 'light' }, expectedRevision: null }),
    ).rejects.toMatchObject({
      code: 'SETTINGS_REVISION_CONFLICT',
    } satisfies Partial<SettingsStoreError>)
    expect(write).not.toHaveBeenCalled()
  })
})
