import { z } from 'zod'

const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const relativePath = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => !value.startsWith('/') && !value.split('/').some((part) => part === '..'))

export const LegacyMigrationCountsSchema = z.strictObject({
  connections: z.number().int().nonnegative(),
  repositories: z.number().int().nonnegative(),
  workflows: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  nodes: z.number().int().nonnegative(),
  traces: z.number().int().nonnegative(),
})

export const LegacyMigrationInstallationManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  migrationId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/),
  state: z.enum(['READY', 'INSTALLING', 'INSTALLED', 'ROLLED_BACK']),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  exportDirectory: z.string().min(1),
  counts: LegacyMigrationCountsSchema,
  files: z
    .array(
      z.strictObject({
        relativePath,
        sizeBytes: z.number().int().nonnegative(),
        sha256,
      }),
    )
    .min(2)
    .readonly(),
  targets: z
    .tuple([
      z.strictObject({ relativePath: z.literal('settings.json') }),
      z.strictObject({ relativePath: z.literal('repositories.json') }),
      z.strictObject({ relativePath: z.literal('workflows') }),
    ])
    .readonly(),
})

export type LegacyMigrationCounts = z.infer<typeof LegacyMigrationCountsSchema>
export type LegacyMigrationInstallationManifest = z.infer<
  typeof LegacyMigrationInstallationManifestSchema
>
