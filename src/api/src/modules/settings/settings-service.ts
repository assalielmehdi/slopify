import {
  SettingsStoreError,
  type SettingsRecord,
  type SettingsRevision,
  type SettingsStore,
  type VersionedSettingsRecord,
} from './settings-store.js'

export interface UpdateSettingsAppearanceInput {
  readonly appearance: SettingsRecord['appearance']
  readonly expectedRevision: SettingsRevision | null
}

export interface SettingsService {
  read(): Promise<VersionedSettingsRecord>
  updateAppearance(input: UpdateSettingsAppearanceInput): Promise<VersionedSettingsRecord>
}

export const createSettingsService = (options: {
  readonly settings: SettingsStore
}): SettingsService => ({
  read: () => options.settings.read(),
  async updateAppearance(input) {
    const current = await options.settings.read()
    if (current.revision !== input.expectedRevision) {
      throw new SettingsStoreError(
        'SETTINGS_REVISION_CONFLICT',
        'Settings changed since they were read',
      )
    }
    return options.settings.write({
      value: { ...current.value, appearance: input.appearance },
      expectedRevision: current.revision,
    })
  },
})
