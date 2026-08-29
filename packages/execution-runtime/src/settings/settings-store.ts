import { GitConnectionSchema, GitProviderSchema, ThemePreferenceSchema } from '@slopify/shared'
import { z } from 'zod'

export const SettingsRevisionSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .brand<'SettingsRevision'>()

export const SettingsCredentialReferenceSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\S+$/u)
  .brand<'SettingsCredentialReference'>()

export const SettingsGitConnectionRecordSchema = GitConnectionSchema.extend({
  credentialReference: SettingsCredentialReferenceSchema,
})

const SettingsGitConnectionRecordsSchema = z
  .array(SettingsGitConnectionRecordSchema)
  .max(GitProviderSchema.options.length)
  .superRefine((connections, context) => {
    const providers = new Set<string>()
    for (const [index, connection] of connections.entries()) {
      if (providers.has(connection.provider)) {
        context.addIssue({
          code: 'custom',
          message: 'Git connection providers must be unique',
          path: [index, 'provider'],
        })
      }
      providers.add(connection.provider)
    }
  })
  .readonly()

export const SettingsRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  appearance: z.strictObject({ theme: ThemePreferenceSchema }),
  git: z.strictObject({ connections: SettingsGitConnectionRecordsSchema }),
})

export type SettingsRevision = z.infer<typeof SettingsRevisionSchema>
export type SettingsCredentialReference = z.infer<typeof SettingsCredentialReferenceSchema>
export type SettingsGitConnectionRecord = z.infer<typeof SettingsGitConnectionRecordSchema>
export type SettingsRecord = z.infer<typeof SettingsRecordSchema>

export type SettingsStoreErrorCode =
  'SETTINGS_FILE_INVALID' | 'SETTINGS_REVISION_CONFLICT' | 'SETTINGS_UNAVAILABLE'

export class SettingsStoreError extends Error {
  readonly code: SettingsStoreErrorCode

  constructor(code: SettingsStoreErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'SettingsStoreError'
    this.code = code
  }
}

export interface VersionedSettingsRecord {
  readonly value: SettingsRecord
  readonly revision: SettingsRevision | null
}

export interface WriteSettingsInput {
  readonly value: SettingsRecord
  readonly expectedRevision: SettingsRevision | null
}

export interface SettingsStore {
  read(): Promise<VersionedSettingsRecord>
  write(input: WriteSettingsInput): Promise<VersionedSettingsRecord>
}
