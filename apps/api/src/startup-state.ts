import { lstat, mkdir, rm } from 'node:fs/promises'

import {
  createLegacyCatalogConverter,
  createLegacyMigrationInstaller,
  createLegacyMigrationService,
  createLegacyRunConverter,
  loadLegacyMigrationPreparation,
  readLegacyMigrationInstallationManifest,
  type LegacyMigrationCounts,
  type LegacyMigrationPreparation,
  type SlopifyPaths,
} from '@slopify/execution-runtime'

export const STARTUP_MIGRATION_ID = 'sqlite-filesystem-v1'

export type FilesystemStartupState =
  | Readonly<{ state: 'CLEAN' }>
  | Readonly<{ state: 'MIGRATED' | 'READY'; counts: LegacyMigrationCounts }>

export class FilesystemStartupError extends Error {
  override readonly name = 'FilesystemStartupError'

  constructor(
    readonly code: 'MIGRATION_ROLLED_BACK',
    message: string,
  ) {
    super(message)
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

const convert = async (options: {
  readonly preparation: LegacyMigrationPreparation
  readonly legacyTracesRoot: string
}): Promise<LegacyMigrationCounts> => {
  await rm(options.preparation.exportDirectory, { recursive: true, force: true })
  await mkdir(options.preparation.exportDirectory, { recursive: true, mode: 0o700 })
  const catalog = await createLegacyCatalogConverter({
    preparation: options.preparation,
  }).convert()
  const runs = await createLegacyRunConverter({
    preparation: options.preparation,
    legacyTracesRoot: options.legacyTracesRoot,
  }).convert()
  return { ...catalog, ...runs }
}

export const prepareFilesystemStartup = async (options: {
  readonly paths: SlopifyPaths
  readonly databasePath: string
  readonly legacyTracesRoot: string
  readonly now?: () => string
}): Promise<FilesystemStartupState> => {
  let preparation = await loadLegacyMigrationPreparation({
    paths: options.paths,
    migrationId: STARTUP_MIGRATION_ID,
  })
  if (preparation !== undefined) {
    const installation = await readLegacyMigrationInstallationManifest(preparation)
    if (installation?.state === 'INSTALLED') return { state: 'READY', counts: installation.counts }
    if (installation?.state === 'ROLLED_BACK')
      throw new FilesystemStartupError(
        'MIGRATION_ROLLED_BACK',
        'The legacy migration was rolled back and requires operator recovery.',
      )
    if (installation !== undefined) {
      const installed = await createLegacyMigrationInstaller({
        paths: options.paths,
        preparation,
        expected: installation.counts,
        ...(options.now === undefined ? {} : { now: options.now }),
      }).install()
      return { state: 'READY', counts: installed.counts }
    }
  } else {
    if (!(await exists(options.databasePath))) return { state: 'CLEAN' }
    preparation = await createLegacyMigrationService({
      databasePath: options.databasePath,
      paths: options.paths,
      createMigrationId: () => STARTUP_MIGRATION_ID,
      ...(options.now === undefined ? {} : { now: options.now }),
    }).prepare()
  }

  const counts = await convert({ preparation, legacyTracesRoot: options.legacyTracesRoot })
  const installed = await createLegacyMigrationInstaller({
    paths: options.paths,
    preparation,
    expected: counts,
    ...(options.now === undefined ? {} : { now: options.now }),
  }).install()
  return { state: 'MIGRATED', counts: installed.counts }
}
