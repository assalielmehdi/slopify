import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { z } from 'zod'

import type { SlopifyPaths } from '../filesystem/slopify-home.js'
import { LegacySqliteReaderError, openLegacySqliteReader } from './legacy-sqlite-reader.js'

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const MigrationFileSchema = z.object({
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: Sha256Schema,
})

export const LegacyMigrationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  migrationId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/),
  state: z.literal('BACKED_UP'),
  createdAt: z.string().datetime({ offset: true }),
  legacySchemaVersion: z.number().int().min(1).max(4),
  source: MigrationFileSchema,
  backup: MigrationFileSchema,
  sidecars: z
    .array(
      z.object({
        kind: z.enum(['WAL', 'SHM']),
        source: MigrationFileSchema,
        backup: MigrationFileSchema,
      }),
    )
    .max(2),
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

export interface LegacyMigrationReadSnapshot {
  readonly databasePath: string
  readonly manifest: LegacyMigrationManifest
  cleanup(): Promise<void>
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

export const loadLegacyMigrationPreparation = async (options: {
  readonly paths: SlopifyPaths
  readonly migrationId: string
}): Promise<LegacyMigrationPreparation | undefined> => {
  const migrationId = LegacyMigrationManifestSchema.shape.migrationId.parse(options.migrationId)
  const directory = join(options.paths.migrationsDirectory, migrationId)
  const manifestPath = join(directory, 'manifest.json')
  let manifest
  try {
    manifest = LegacyMigrationManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new LegacyMigrationError(
      'INVALID_DATABASE',
      'The legacy migration manifest is invalid.',
      {
        cause: error,
      },
    )
  }
  const backupPath = join(directory, 'slopify.db')
  if (manifest.migrationId !== migrationId || resolve(manifest.backup.path) !== resolve(backupPath))
    throw new LegacyMigrationError(
      'INVALID_DATABASE',
      'The legacy migration manifest does not match its filesystem location.',
    )
  return {
    directory,
    backupPath,
    exportDirectory: join(directory, 'export'),
    manifestPath,
    manifest,
  }
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

interface SidecarSnapshot {
  readonly kind: 'WAL' | 'SHM'
  readonly suffix: '-wal' | '-shm'
  readonly path: string
  readonly sizeBytes: number
  readonly sha256: string
}

const readSidecars = async (databasePath: string): Promise<readonly SidecarSnapshot[]> => {
  const sidecars: SidecarSnapshot[] = []
  for (const entry of [
    { kind: 'WAL' as const, suffix: '-wal' as const },
    { kind: 'SHM' as const, suffix: '-shm' as const },
  ]) {
    const path = `${databasePath}${entry.suffix}`
    try {
      const metadata = await lstat(path)
      if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new LegacyMigrationError(
          'INVALID_DATABASE',
          'Legacy SQLite sidecars must be regular files.',
        )
      sidecars.push({
        ...entry,
        path,
        sizeBytes: metadata.size,
        sha256: await calculateFileSha256(path),
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return sidecars
}

const isNonEmptyDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await readdir(path)).length > 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export const calculateFileSha256 = async (path: string): Promise<string> => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export const verifyLegacyMigrationBackup = async (
  preparation: LegacyMigrationPreparation,
): Promise<LegacyMigrationManifest> => {
  const manifest = LegacyMigrationManifestSchema.parse(preparation.manifest)
  if (resolve(preparation.backupPath) !== resolve(manifest.backup.path))
    throw new LegacyMigrationError(
      'SOURCE_CHANGED',
      'The legacy database backup path does not match its manifest.',
    )
  const backupStat = await lstat(preparation.backupPath)
  const backupHash = await calculateFileSha256(preparation.backupPath)
  if (
    !backupStat.isFile() ||
    backupStat.isSymbolicLink() ||
    backupStat.size !== manifest.backup.sizeBytes ||
    backupHash !== manifest.backup.sha256
  )
    throw new LegacyMigrationError(
      'SOURCE_CHANGED',
      'The legacy database backup no longer matches its manifest.',
    )
  for (const sidecar of manifest.sidecars) {
    const expectedPath = `${preparation.backupPath}${sidecar.kind === 'WAL' ? '-wal' : '-shm'}`
    if (resolve(sidecar.backup.path) !== resolve(expectedPath))
      throw new LegacyMigrationError(
        'SOURCE_CHANGED',
        'A legacy database backup sidecar path does not match its manifest.',
      )
    const sidecarStat = await lstat(sidecar.backup.path)
    const sidecarHash = await calculateFileSha256(sidecar.backup.path)
    if (
      !sidecarStat.isFile() ||
      sidecarStat.isSymbolicLink() ||
      sidecarStat.size !== sidecar.backup.sizeBytes ||
      sidecarHash !== sidecar.backup.sha256
    )
      throw new LegacyMigrationError(
        'SOURCE_CHANGED',
        'A legacy database backup sidecar no longer matches its manifest.',
      )
  }
  return manifest
}

export const createLegacyMigrationReadSnapshot = async (
  preparation: LegacyMigrationPreparation,
): Promise<LegacyMigrationReadSnapshot> => {
  const manifest = await verifyLegacyMigrationBackup(preparation)
  const directory = join(preparation.directory, `.read-${crypto.randomUUID()}`)
  const databasePath = join(directory, 'slopify.db')
  try {
    await mkdir(directory, { mode: 0o700 })
    await copyFile(preparation.backupPath, databasePath)
    await Promise.all(
      manifest.sidecars.map((sidecar) =>
        copyFile(sidecar.backup.path, `${databasePath}${sidecar.kind === 'WAL' ? '-wal' : '-shm'}`),
      ),
    )
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return {
    databasePath,
    manifest,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
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

    const sourceHashBefore = await calculateFileSha256(databasePath)
    const sidecarsBeforeInspection = await readSidecars(databasePath)
    const hasWalFrames = sidecarsBeforeInspection.some(
      (sidecar) => sidecar.kind === 'WAL' && sidecar.sizeBytes > 0,
    )
    const reader = (() => {
      try {
        return openLegacySqliteReader(databasePath, { immutable: !hasWalFrames })
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
    const sourceSidecars = await readSidecars(databasePath)

    const sourceHashAfterInspection = await calculateFileSha256(databasePath)
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
      await Promise.all(
        sourceSidecars.map((sidecar) =>
          copyFile(sidecar.path, `${stagedBackupPath}${sidecar.suffix}`),
        ),
      )
      const [sourceHashAfterCopy, backupHash, backupStat] = await Promise.all([
        calculateFileSha256(databasePath),
        calculateFileSha256(stagedBackupPath),
        lstat(stagedBackupPath),
      ])
      if (sourceHashAfterCopy !== sourceHashBefore || backupHash !== sourceHashBefore)
        throw new LegacyMigrationError(
          'SOURCE_CHANGED',
          'The legacy database changed while its backup was created.',
        )
      const [sourceSidecarsAfterCopy, backupSidecars] = await Promise.all([
        readSidecars(databasePath),
        Promise.all(
          sourceSidecars.map(async (sidecar) => {
            const path = `${stagedBackupPath}${sidecar.suffix}`
            const metadata = await lstat(path)
            return {
              kind: sidecar.kind,
              path,
              sizeBytes: metadata.size,
              sha256: await calculateFileSha256(path),
            }
          }),
        ),
      ])
      if (
        JSON.stringify(sourceSidecarsAfterCopy) !== JSON.stringify(sourceSidecars) ||
        backupSidecars.some(
          (backup, index) =>
            backup.sizeBytes !== sourceSidecars[index]?.sizeBytes ||
            backup.sha256 !== sourceSidecars[index]?.sha256,
        )
      )
        throw new LegacyMigrationError(
          'SOURCE_CHANGED',
          'The legacy database journal changed while its backup was created.',
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
        sidecars: sourceSidecars.map((source, index) => ({
          kind: source.kind,
          source: {
            path: source.path,
            sizeBytes: source.sizeBytes,
            sha256: source.sha256,
          },
          backup: {
            path: `${backupPath}${source.suffix}`,
            sizeBytes: backupSidecars[index]?.sizeBytes,
            sha256: backupSidecars[index]?.sha256,
          },
        })),
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
