import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { z } from 'zod'

import type { SlopifyPaths } from '../filesystem/slopify-home.js'
import { LegacySqliteReaderError, openLegacySqliteReader } from './legacy-sqlite-reader.js'

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)

export const LegacyMigrationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  migrationId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/),
  state: z.literal('BACKED_UP'),
  createdAt: z.string().datetime({ offset: true }),
  legacySchemaVersion: z.number().int().min(1).max(4),
  source: z.object({
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256: Sha256Schema,
  }),
  backup: z.object({
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256: Sha256Schema,
  }),
})

export type LegacyMigrationManifest = z.infer<typeof LegacyMigrationManifestSchema>

export type LegacyMigrationErrorCode =
  'ACTIVE_RUNS' | 'INVALID_DATABASE' | 'SOURCE_CHANGED' | 'TARGET_CONFLICT'

export class LegacyMigrationError extends Error {
  constructor(
    readonly code: LegacyMigrationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'LegacyMigrationError'
  }
}

export interface LegacyMigrationPreparation {
  readonly directory: string
  readonly backupPath: string
  readonly exportDirectory: string
  readonly manifestPath: string
  readonly manifest: LegacyMigrationManifest
}

export interface LegacyMigrationService {
  prepare(): Promise<LegacyMigrationPreparation>
}

export interface CreateLegacyMigrationServiceOptions {
  readonly databasePath: string
  readonly paths: SlopifyPaths
  readonly createMigrationId?: () => string
  readonly now?: () => string
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const isNonEmptyDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await readdir(path)).length > 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const hashFile = async (path: string): Promise<string> => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

const assertMigrationTargetsAreEmpty = async (
  paths: SlopifyPaths,
  migrationDirectory: string,
): Promise<void> => {
  const conflict =
    (await exists(paths.settingsFile)) ||
    (await exists(paths.repositoriesFile)) ||
    (await isNonEmptyDirectory(paths.workflowsDirectory)) ||
    (await exists(migrationDirectory))
  if (conflict)
    throw new LegacyMigrationError(
      'TARGET_CONFLICT',
      'Filesystem migration targets already contain Slopify data.',
    )
}

export const createLegacyMigrationService = (
  options: CreateLegacyMigrationServiceOptions,
): LegacyMigrationService => ({
  async prepare() {
    const databasePath = resolve(options.databasePath)
    const migrationId = LegacyMigrationManifestSchema.shape.migrationId.parse(
      options.createMigrationId?.() ?? `sqlite-${crypto.randomUUID()}`,
    )
    const directory = join(options.paths.migrationsDirectory, migrationId)
    await assertMigrationTargetsAreEmpty(options.paths, directory)

    let sourceStat
    try {
      sourceStat = await lstat(databasePath)
    } catch (error) {
      throw new LegacyMigrationError('INVALID_DATABASE', 'The legacy database does not exist.', {
        cause: error,
      })
    }
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
      throw new LegacyMigrationError(
        'INVALID_DATABASE',
        'The legacy database must be a regular file.',
      )

    const sourceHashBefore = await hashFile(databasePath)
    const reader = (() => {
      try {
        return openLegacySqliteReader(databasePath)
      } catch (error) {
        if (error instanceof LegacySqliteReaderError)
          throw new LegacyMigrationError('INVALID_DATABASE', error.message, { cause: error })
        throw error
      }
    })()
    let inspection
    try {
      inspection = reader.inspect()
    } catch (error) {
      if (error instanceof LegacySqliteReaderError)
        throw new LegacyMigrationError('INVALID_DATABASE', error.message, { cause: error })
      throw error
    } finally {
      reader.close()
    }
    if (inspection.activeRuns.length > 0)
      throw new LegacyMigrationError(
        'ACTIVE_RUNS',
        'Legacy migration requires all workflow runs to be terminal.',
      )

    const sourceHashAfterInspection = await hashFile(databasePath)
    if (sourceHashAfterInspection !== sourceHashBefore)
      throw new LegacyMigrationError(
        'SOURCE_CHANGED',
        'The legacy database changed during preflight.',
      )

    const stagingDirectory = join(
      options.paths.migrationsDirectory,
      `.${migrationId}.tmp-${crypto.randomUUID()}`,
    )
    const backupPath = join(directory, 'slopify.db')
    const exportDirectory = join(directory, 'export')
    const manifestPath = join(directory, 'manifest.json')
    try {
      await mkdir(join(stagingDirectory, 'export'), { recursive: true, mode: 0o700 })
      const stagedBackupPath = join(stagingDirectory, 'slopify.db')
      await copyFile(databasePath, stagedBackupPath)
      const [sourceHashAfterCopy, backupHash, backupStat] = await Promise.all([
        hashFile(databasePath),
        hashFile(stagedBackupPath),
        lstat(stagedBackupPath),
      ])
      if (sourceHashAfterCopy !== sourceHashBefore || backupHash !== sourceHashBefore)
        throw new LegacyMigrationError(
          'SOURCE_CHANGED',
          'The legacy database changed while its backup was created.',
        )

      const manifest = LegacyMigrationManifestSchema.parse({
        schemaVersion: 1,
        migrationId,
        state: 'BACKED_UP',
        createdAt: options.now?.() ?? new Date().toISOString(),
        legacySchemaVersion: inspection.schemaVersion,
        source: {
          path: databasePath,
          sizeBytes: sourceStat.size,
          sha256: sourceHashBefore,
        },
        backup: {
          path: backupPath,
          sizeBytes: backupStat.size,
          sha256: backupHash,
        },
      })
      await writeFile(
        join(stagingDirectory, basename(manifestPath)),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      )
      await mkdir(options.paths.migrationsDirectory, { recursive: true, mode: 0o700 })
      await rename(stagingDirectory, directory)
      return { directory, backupPath, exportDirectory, manifestPath, manifest }
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true })
      throw error
    }
  },
})
