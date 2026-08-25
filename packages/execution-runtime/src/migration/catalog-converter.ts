import { lstat } from 'node:fs/promises'

import {
  WorkflowSchema,
  convertWorkflowV1,
  validateWorkflow,
  workflowToWorkflowFile,
} from '@slopify/workflow-model'

import { resolveSlopifyPaths } from '../filesystem/slopify-home.js'
import { createFilesystemRepositoryStore } from '../repositories/filesystem-repository-store.js'
import { createFilesystemSettingsStore } from '../settings/filesystem-settings-store.js'
import { gitCredentialReference } from '../settings/filesystem-git-connection-repository.js'
import { SettingsRecordSchema } from '../settings/settings-store.js'
import { createFilesystemWorkflowStore } from '../workflows/filesystem-workflow-store.js'
import { openLegacySqliteReader } from './legacy-sqlite-reader.js'
import {
  LegacyMigrationError,
  LegacyMigrationManifestSchema,
  calculateFileSha256,
  type LegacyMigrationPreparation,
} from './migration-service.js'

export interface LegacyCatalogConversionResult {
  readonly connections: number
  readonly repositories: number
  readonly workflows: number
}

export interface LegacyCatalogConverter {
  convert(): Promise<LegacyCatalogConversionResult>
}

export const createLegacyCatalogConverter = (options: {
  readonly preparation: LegacyMigrationPreparation
}): LegacyCatalogConverter => ({
  async convert() {
    const manifest = LegacyMigrationManifestSchema.parse(options.preparation.manifest)
    const backupStat = await lstat(options.preparation.backupPath)
    const backupHash = await calculateFileSha256(options.preparation.backupPath)
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

    const hasWalFrames = manifest.sidecars.some(
      (sidecar) => sidecar.kind === 'WAL' && sidecar.backup.sizeBytes > 0,
    )
    const reader = openLegacySqliteReader(options.preparation.backupPath, {
      immutable: !hasWalFrames,
    })
    let catalog
    try {
      const inspection = reader.inspect()
      if (inspection.activeRuns.length > 0)
        throw new LegacyMigrationError(
          'ACTIVE_RUNS',
          'Legacy migration requires all workflow runs to be terminal.',
        )
      catalog = reader.readCatalog()
    } finally {
      reader.close()
    }

    const paths = resolveSlopifyPaths({
      environment: { SLOPIFY_HOME: options.preparation.exportDirectory },
    })
    const settings = createFilesystemSettingsStore({ paths })
    const repositories = createFilesystemRepositoryStore({ paths })
    const workflows = createFilesystemWorkflowStore({ paths })
    const repositoryIds = new Set(catalog.repositories.map((repository) => repository.repositoryId))
    const workflowFiles = catalog.workflows.map((entry) => {
      const envelope = entry.definition as { readonly schemaVersion?: unknown }
      const parsed =
        envelope?.schemaVersion === 1
          ? convertWorkflowV1(entry.definition)
          : WorkflowSchema.parse(entry.definition)
      const validation = validateWorkflow(parsed)
      if (!validation.valid)
        throw new LegacyMigrationError('INVALID_DATABASE', 'A legacy workflow graph is invalid.')
      if (validation.workflow.workflowId !== entry.workflowId)
        throw new LegacyMigrationError(
          'INVALID_DATABASE',
          'A legacy workflow row does not match its definition ID.',
        )
      if (
        validation.workflow.configuration.repositoryIds.some(
          (repositoryId) => !repositoryIds.has(repositoryId),
        )
      )
        throw new LegacyMigrationError(
          'INVALID_DATABASE',
          'A legacy workflow references a repository that is not available for migration.',
        )
      return workflowToWorkflowFile(validation.workflow)
    })

    await settings.write({
      value: SettingsRecordSchema.parse({
        schemaVersion: 1,
        appearance: { theme: 'system' },
        git: {
          connections: catalog.connections.map((connection) => ({
            ...connection,
            credentialReference: gitCredentialReference(connection.provider),
          })),
        },
      }),
      expectedRevision: null,
    })
    for (const repository of catalog.repositories) await repositories.add(repository)
    for (const workflow of workflowFiles) await workflows.create(workflow)

    return {
      connections: catalog.connections.length,
      repositories: catalog.repositories.length,
      workflows: catalog.workflows.length,
    }
  },
})
