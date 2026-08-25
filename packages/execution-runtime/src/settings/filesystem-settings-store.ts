import {
  createAtomicJsonResourceIO,
  type AtomicJsonResourceIO,
} from '../filesystem/atomic-json-resource.js'
import { FilesystemResourceError } from '../filesystem/filesystem-errors.js'
import { ResourceRevisionSchema } from '../filesystem/resource-revision.js'
import type { SlopifyPaths } from '../filesystem/slopify-home.js'
import {
  SettingsRecordSchema,
  SettingsRevisionSchema,
  SettingsStoreError,
  type SettingsRecord,
  type SettingsStore,
  type VersionedSettingsRecord,
} from './settings-store.js'

const MAX_SETTINGS_BYTES = 1_048_576

const storeError = (cause: unknown): SettingsStoreError => {
  if (cause instanceof SettingsStoreError) return cause
  if (cause instanceof FilesystemResourceError) {
    if (cause.code === 'RESOURCE_REVISION_CONFLICT')
      return new SettingsStoreError(
        'SETTINGS_REVISION_CONFLICT',
        'Settings changed since they were read',
        cause,
      )
    if (
      cause.code === 'RESOURCE_MALFORMED' ||
      cause.code === 'RESOURCE_VALIDATION_FAILED' ||
      cause.code === 'RESOURCE_TOO_LARGE' ||
      cause.code === 'RESOURCE_SYMLINK_NOT_ALLOWED' ||
      cause.code === 'RESOURCE_NOT_FILE'
    )
      return new SettingsStoreError('SETTINGS_FILE_INVALID', 'Settings file is invalid', cause)
  }
  return new SettingsStoreError('SETTINGS_UNAVAILABLE', 'Settings are unavailable', cause)
}

const defaultSettings = (): SettingsRecord =>
  SettingsRecordSchema.parse({
    schemaVersion: 1,
    appearance: { theme: 'system' },
    git: { connections: [] },
  })

export const createFilesystemSettingsStore = (
  options: Readonly<{
    paths: Pick<SlopifyPaths, 'settingsFile'>
    resources?: AtomicJsonResourceIO
  }>,
): SettingsStore => {
  const resources = options.resources ?? createAtomicJsonResourceIO()

  return {
    async read(): Promise<VersionedSettingsRecord> {
      try {
        const result = await resources.readVersioned({
          path: options.paths.settingsFile,
          schema: SettingsRecordSchema,
          maxBytes: MAX_SETTINGS_BYTES,
        })
        return {
          value: result.value,
          revision: SettingsRevisionSchema.parse(result.revision),
        }
      } catch (cause) {
        if (cause instanceof FilesystemResourceError && cause.code === 'RESOURCE_NOT_FOUND') {
          return { value: defaultSettings(), revision: null }
        }
        throw storeError(cause)
      }
    },

    async write(input): Promise<VersionedSettingsRecord> {
      try {
        const result = await resources.writeVersioned({
          path: options.paths.settingsFile,
          schema: SettingsRecordSchema,
          value: input.value,
          expectedRevision:
            input.expectedRevision === null
              ? null
              : ResourceRevisionSchema.parse(input.expectedRevision),
          maxBytes: MAX_SETTINGS_BYTES,
        })
        return {
          value: result.value,
          revision: SettingsRevisionSchema.parse(result.revision),
        }
      } catch (cause) {
        throw storeError(cause)
      }
    },
  }
}
