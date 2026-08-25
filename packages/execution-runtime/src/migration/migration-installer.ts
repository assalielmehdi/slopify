import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { calculateFileSha256 } from './migration-service.js'
import {
  LegacyMigrationCountsSchema,
  LegacyMigrationInstallationManifestSchema,
  type LegacyMigrationCounts,
  type LegacyMigrationInstallationManifest,
} from './migration-manifest.js'
import { createFilesystemSettingsStore } from '../settings/filesystem-settings-store.js'
import { createFilesystemRepositoryStore } from '../repositories/filesystem-repository-store.js'
import { createFilesystemWorkflowStore } from '../workflows/filesystem-workflow-store.js'
import { createFilesystemRunIndex, createFilesystemRunReader } from '../runs/run-index.js'
import { createRunFilesystemAgentTraceStore } from '../traces/filesystem-agent-trace-store.js'
import { resolveNodeExecutionPaths } from '../runs/run-layout.js'
import { resolveSlopifyPaths, type SlopifyPaths } from '../filesystem/slopify-home.js'
import {
  verifyLegacyMigrationBackup,
  type LegacyMigrationPreparation,
} from './migration-service.js'

const targetNames = ['settings.json', 'repositories.json', 'workflows'] as const

export type LegacyMigrationInstallerErrorCode =
  'INVALID_EXPORT' | 'TARGET_CONFLICT' | 'TARGET_CHANGED' | 'NOT_INSTALLED'

export class LegacyMigrationInstallerError extends Error {
  override readonly name = 'LegacyMigrationInstallerError'

  constructor(
    readonly code: LegacyMigrationInstallerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

interface ExportFile {
  readonly relativePath: string
  readonly sizeBytes: number
  readonly sha256: string
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

const walkFiles = async (root: string): Promise<readonly ExportFile[]> => {
  const rootMetadata = await lstat(root)
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink())
    throw new LegacyMigrationInstallerError(
      'INVALID_EXPORT',
      'The migration export must be a regular directory.',
    )
  const files: ExportFile[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
        throw new LegacyMigrationInstallerError(
          'INVALID_EXPORT',
          'Migration exports may contain only regular files and directories.',
        )
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      const metadata = await lstat(path)
      const relativePath = relative(root, path).split(sep).join('/')
      files.push({
        relativePath,
        sizeBytes: metadata.size,
        sha256: await calculateFileSha256(path),
      })
    }
  }
  await visit(root)
  return files.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath))
}

const sameFiles = (left: readonly ExportFile[], right: readonly ExportFile[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const targetFiles = (
  files: readonly ExportFile[],
  target: (typeof targetNames)[number],
): readonly ExportFile[] =>
  files.filter(
    ({ relativePath }) => relativePath === target || relativePath.startsWith(`${target}/`),
  )

const targetPath = (paths: SlopifyPaths, target: (typeof targetNames)[number]): string => {
  if (target === 'settings.json') return paths.settingsFile
  if (target === 'repositories.json') return paths.repositoriesFile
  return paths.workflowsDirectory
}

const inspectTarget = async (
  paths: SlopifyPaths,
  target: (typeof targetNames)[number],
): Promise<readonly ExportFile[]> => {
  const path = targetPath(paths, target)
  if (target !== 'workflows') {
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) return []
    return [
      {
        relativePath: target,
        sizeBytes: metadata.size,
        sha256: await calculateFileSha256(path),
      },
    ]
  }
  return (await walkFiles(path)).map((file) => ({
    ...file,
    relativePath: `workflows/${file.relativePath}`,
  }))
}

const readManifest = async (
  path: string,
): Promise<LegacyMigrationInstallationManifest | undefined> => {
  try {
    return LegacyMigrationInstallationManifestSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new LegacyMigrationInstallerError(
      'INVALID_EXPORT',
      'The migration installation manifest is invalid.',
      { cause: error },
    )
  }
}

const writeManifest = async (
  path: string,
  manifest: LegacyMigrationInstallationManifest,
): Promise<void> => {
  const parsed = LegacyMigrationInstallationManifestSchema.parse(manifest)
  const temporaryPath = `${path}.tmp-${crypto.randomUUID()}`
  await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  await rename(temporaryPath, path)
}

const validateExport = async (
  preparation: LegacyMigrationPreparation,
  expected: LegacyMigrationCounts,
): Promise<readonly ExportFile[]> => {
  const expectedCounts = LegacyMigrationCountsSchema.parse(expected)
  await verifyLegacyMigrationBackup(preparation)
  const before = await walkFiles(preparation.exportDirectory)
  if (
    !before.some(({ relativePath }) => relativePath === 'settings.json') ||
    !before.some(({ relativePath }) => relativePath === 'repositories.json') ||
    before.some(
      ({ relativePath }) =>
        !targetNames.some(
          (target) => relativePath === target || relativePath.startsWith(`${target}/`),
        ),
    )
  )
    throw new LegacyMigrationInstallerError(
      'INVALID_EXPORT',
      'The migration export layout is incomplete or contains unsupported resources.',
    )

  try {
    const exportPaths = resolveSlopifyPaths({
      environment: { SLOPIFY_HOME: preparation.exportDirectory },
    })
    const settings = await createFilesystemSettingsStore({ paths: exportPaths }).read()
    const repositories = await createFilesystemRepositoryStore({ paths: exportPaths }).list()
    const repositoryIds = new Set(repositories.map(({ repositoryId }) => repositoryId))
    const workflows = await createFilesystemWorkflowStore({ paths: exportPaths }).list()
    if (workflows.some(({ status }) => status !== 'VALID')) throw new Error('invalid workflow')
    for (const entry of workflows) {
      if (entry.status !== 'VALID') continue
      if (entry.value.repositories.repositoryIds.some((id) => !repositoryIds.has(id)))
        throw new Error('missing workflow repository')
    }

    const index = createFilesystemRunIndex({ paths: exportPaths })
    const reader = createFilesystemRunReader({ index, paths: exportPaths })
    const traces = createRunFilesystemAgentTraceStore({ paths: exportPaths })
    const runEntries = []
    for (let page = 1; ; page += 1) {
      const result = await index.list({ page, pageSize: 100 })
      runEntries.push(...result.data)
      if (page >= result.pagination.totalPages) break
    }
    let nodes = 0
    let traceCount = 0
    for (const entry of runEntries) {
      if (entry.status !== 'READY') throw new Error('invalid run projection')
      const detail = await reader.get(entry.locator.runId)
      if (detail === undefined || detail.status !== 'READY') throw new Error('invalid run detail')
      if (
        detail.workflowSnapshot.workflow.workflowId !== entry.locator.workflowId ||
        detail.repositoriesSnapshot.repositories.some(
          ({ repositoryId }) => !repositoryIds.has(repositoryId),
        )
      )
        throw new Error('invalid run reference')
      nodes += detail.executions.length
      for (const execution of detail.executions) {
        const tracePath = resolveNodeExecutionPaths(
          exportPaths.run(entry.locator.workflowId, entry.locator.runId),
          execution.executionIndex,
          execution.nodeExecutionId,
        ).traceFile
        if (!(await exists(tracePath))) continue
        await traces.read({
          workflowId: entry.locator.workflowId,
          runId: entry.locator.runId,
          nodeExecutionId: execution.nodeExecutionId,
          attemptId: execution.attemptId,
          executionIndex: execution.executionIndex,
        })
        traceCount += 1
      }
    }
    const actual = LegacyMigrationCountsSchema.parse({
      connections: settings.value.git.connections.length,
      repositories: repositories.length,
      workflows: workflows.length,
      runs: runEntries.length,
      nodes,
      traces: traceCount,
    })
    if (JSON.stringify(actual) !== JSON.stringify(expectedCounts)) throw new Error('count mismatch')
  } catch (error) {
    if (error instanceof LegacyMigrationInstallerError) throw error
    throw new LegacyMigrationInstallerError(
      'INVALID_EXPORT',
      'The migration export failed complete schema, reference, or count validation.',
      { cause: error },
    )
  }

  const after = await walkFiles(preparation.exportDirectory)
  if (!sameFiles(before, after))
    throw new LegacyMigrationInstallerError(
      'INVALID_EXPORT',
      'The migration export changed during validation.',
    )
  return after
}

export interface LegacyMigrationInstaller {
  install(): Promise<LegacyMigrationInstallationManifest>
  rollback(): Promise<LegacyMigrationInstallationManifest>
}

export const createLegacyMigrationInstaller = (options: {
  readonly paths: SlopifyPaths
  readonly preparation: LegacyMigrationPreparation
  readonly expected: LegacyMigrationCounts
  readonly now?: () => string
  readonly afterTargetInstalled?: (relativePath: string) => void | Promise<void>
}): LegacyMigrationInstaller => {
  const manifestPath = join(options.preparation.directory, 'installation.json')
  const stagingDirectory = join(options.preparation.directory, '.install-staging')
  const now = () => options.now?.() ?? new Date().toISOString()

  return {
    async install() {
      const existing = await readManifest(manifestPath)
      if (existing?.state === 'INSTALLED') return existing
      if (existing?.state === 'ROLLED_BACK')
        throw new LegacyMigrationInstallerError(
          'TARGET_CONFLICT',
          'A rolled-back migration cannot be installed again.',
        )
      const files = await validateExport(options.preparation, options.expected)
      const createdAt = existing?.createdAt ?? now()
      let manifest = LegacyMigrationInstallationManifestSchema.parse({
        schemaVersion: 1,
        migrationId: options.preparation.manifest.migrationId,
        state: 'READY',
        createdAt,
        updatedAt: now(),
        exportDirectory: resolve(options.preparation.exportDirectory),
        counts: options.expected,
        files,
        targets: targetNames.map((relativePath) => ({ relativePath })),
      })
      await writeManifest(manifestPath, manifest)

      await rm(stagingDirectory, { recursive: true, force: true })
      await mkdir(join(stagingDirectory, 'workflows'), { recursive: true, mode: 0o700 })
      for (const file of files) {
        const source = join(options.preparation.exportDirectory, file.relativePath)
        const destination = join(stagingDirectory, file.relativePath)
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
        await copyFile(source, destination)
      }
      manifest = { ...manifest, state: 'INSTALLING', updatedAt: now() }
      await writeManifest(manifestPath, manifest)

      for (const target of targetNames) {
        const destination = targetPath(options.paths, target)
        const expectedFiles = targetFiles(files, target)
        if (await exists(destination)) {
          const actualFiles = await inspectTarget(options.paths, target)
          if (!sameFiles(expectedFiles, actualFiles))
            throw new LegacyMigrationInstallerError(
              'TARGET_CONFLICT',
              `Migration target ${target} already contains different data.`,
            )
        } else {
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
          await rename(join(stagingDirectory, target), destination)
        }
        await options.afterTargetInstalled?.(target)
      }
      await rm(stagingDirectory, { recursive: true, force: true })
      manifest = { ...manifest, state: 'INSTALLED', updatedAt: now() }
      await writeManifest(manifestPath, manifest)
      return manifest
    },

    async rollback() {
      const manifest = await readManifest(manifestPath)
      if (manifest === undefined || manifest.state === 'READY')
        throw new LegacyMigrationInstallerError(
          'NOT_INSTALLED',
          'The migration has no installed targets to roll back.',
        )
      if (manifest.state === 'ROLLED_BACK') return manifest
      for (const target of targetNames) {
        const destination = targetPath(options.paths, target)
        if (!(await exists(destination))) continue
        const actualFiles = await inspectTarget(options.paths, target)
        if (!sameFiles(targetFiles(manifest.files, target), actualFiles))
          throw new LegacyMigrationInstallerError(
            'TARGET_CHANGED',
            `Migration target ${target} changed after installation.`,
          )
      }
      for (const target of targetNames.toReversed())
        await rm(targetPath(options.paths, target), { recursive: true, force: true })
      await rm(stagingDirectory, { recursive: true, force: true })
      const rolledBack = { ...manifest, state: 'ROLLED_BACK' as const, updatedAt: now() }
      await writeManifest(manifestPath, rolledBack)
      return rolledBack
    },
  }
}
