import { createHash } from 'node:crypto'
import { lstat, realpath, rm } from 'node:fs/promises'

import { RepositoryIdSchema, RunIdSchema } from '@slopify/shared'

import {
  createAtomicJsonResourceIO,
  type AtomicJsonResourceIO,
} from '../filesystem/atomic-json-resource.js'
import type { SlopifyPaths } from '../filesystem/slopify-home.js'
import type { ProcessRunner } from '../processes/process-runner.js'
import { createFilesystemRunJournal } from '../runs/filesystem-run-journal.js'
import {
  RunRepositoriesSnapshotSchema,
  type RunWorkspaceProjection,
} from '../runs/run-artifacts.js'
import type { RunJournal } from '../runs/run-journal.js'
import type { JournalRunLocator } from '../orchestration/journal-execution-worker.js'
import { createNativeGitRunWorkspaceProvisioner } from './native-git-run-workspace-provisioner.js'
import type { FilesystemRunWorkspaceProvisioner } from './run-workspace-provisioner.js'

export interface CreateFilesystemGitRunWorkspaceProvisionerOptions {
  readonly paths: Pick<SlopifyPaths, 'run'>
  readonly processRunner: ProcessRunner
  readonly credentialHelper: string
  readonly resources?: AtomicJsonResourceIO
  readonly timeoutMs?: number
  readonly now?: () => string
}

const stableId = (prefix: string, ...parts: readonly string[]): string =>
  `${prefix}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24)}`

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
}

const requireDirectory = async (path: string, label: string): Promise<void> => {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`)
  if (!metadata.isDirectory()) throw new Error(`${label} must be a directory`)
  if ((await realpath(path)) !== path) throw new Error(`${label} path contains a symbolic link`)
}

const workspaceState = async (journal: RunJournal): Promise<readonly RunWorkspaceProjection[]> => {
  const repaired = await journal.repairProjections()
  if (repaired.status === 'CORRUPT') throw new Error(repaired.diagnostic.message)
  return repaired.projection.workspaces.workspaces
}

export const createFilesystemGitRunWorkspaceProvisioner = (
  options: CreateFilesystemGitRunWorkspaceProvisionerOptions,
): FilesystemRunWorkspaceProvisioner => {
  const resources = options.resources ?? createAtomicJsonResourceIO()
  const provisioners = new Map<string, ReturnType<typeof createNativeGitRunWorkspaceProvisioner>>()

  const provisionerFor = (locator: JournalRunLocator) => {
    const key = `${locator.workflowId}\0${locator.runId}`
    const existing = provisioners.get(key)
    if (existing !== undefined) return existing
    const paths = options.paths.run(locator.workflowId, locator.runId)
    const journal = createFilesystemRunJournal({ ...locator, paths: options.paths, resources })
    const repositorySnapshot = async () =>
      resources.read({
        path: paths.repositoriesSnapshotFile,
        schema: RunRepositoriesSnapshotSchema,
      })
    const currentWorkspace = async (repositoryId: string) =>
      (await workspaceState(journal)).find((workspace) => workspace.repositoryId === repositoryId)
    const appendPreparing = async (input: {
      readonly repositoryId: string
      readonly workspacePath: string
      readonly branchName: string
      readonly timestamp: string
    }) => {
      const current = await currentWorkspace(input.repositoryId)
      if (current !== undefined) {
        if (
          current.workspacePath !== input.workspacePath ||
          current.branchName !== input.branchName
        ) {
          throw new Error('Persisted run repository workspace is not deterministic')
        }
        return current
      }
      const repository = (await repositorySnapshot()).repositories.find(
        ({ repositoryId }) => repositoryId === input.repositoryId,
      )
      if (repository === undefined) throw new Error('Captured repository was not found')
      await journal.append({
        eventId: stableId('event-workspace-preparing', locator.runId, input.repositoryId),
        timestamp: input.timestamp,
        type: 'WORKSPACE_PREPARING',
        data: {
          repositoryId: repository.repositoryId,
          position: repository.position,
          workspacePath: input.workspacePath,
          branchName: input.branchName,
        },
      })
      return currentWorkspace(input.repositoryId)
    }
    const appendState = async (
      input: Readonly<{ repositoryId: string; timestamp: string }>,
      type: 'WORKSPACE_READY' | 'WORKSPACE_CLEANED',
    ) => {
      const repaired = await journal.repairProjections()
      if (repaired.status === 'CORRUPT') throw new Error(repaired.diagnostic.message)
      await journal.append({
        eventId: stableId(
          `event-${type.toLowerCase().replaceAll('_', '-')}`,
          locator.runId,
          input.repositoryId,
          String(repaired.projection.run.lastEventSequence),
        ),
        timestamp: input.timestamp,
        type,
        data: { repositoryId: RepositoryIdSchema.parse(input.repositoryId) },
      })
      return currentWorkspace(input.repositoryId)
    }
    const native = createNativeGitRunWorkspaceProvisioner({
      runs: {
        async listRunRepositories() {
          return (await repositorySnapshot()).repositories
        },
        async listRunRepositoryWorkspaces() {
          return workspaceState(journal)
        },
        markRunRepositoryWorkspacePreparing: appendPreparing,
        async markRunRepositoryWorkspaceReady(input) {
          return appendState(input, 'WORKSPACE_READY')
        },
        async markRunRepositoryWorkspaceFailed(input) {
          const repaired = await journal.repairProjections()
          if (repaired.status === 'CORRUPT') throw new Error(repaired.diagnostic.message)
          await journal.append({
            eventId: stableId(
              'event-workspace-failed',
              locator.runId,
              input.repositoryId,
              String(repaired.projection.run.lastEventSequence),
            ),
            timestamp: input.timestamp,
            type: 'WORKSPACE_FAILED',
            data: {
              repositoryId: RepositoryIdSchema.parse(input.repositoryId),
              errorMessage: input.errorMessage,
            },
          })
          return currentWorkspace(input.repositoryId)
        },
        async markRunRepositoryWorkspaceCleaned(input) {
          return appendState(input, 'WORKSPACE_CLEANED')
        },
      },
      processRunner: options.processRunner,
      workspacesRoot: paths.directory,
      resolveRunDirectory: () => paths.workspacesDirectory,
      credentialHelper: options.credentialHelper,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.now === undefined ? {} : { now: options.now }),
    })
    provisioners.set(key, native)
    return native
  }

  return {
    async ensure(locator) {
      const prepared = await provisionerFor(locator).ensure(RunIdSchema.parse(locator.runId))
      const snapshot = await resources.read({
        path: options.paths.run(locator.workflowId, locator.runId).repositoriesSnapshotFile,
        schema: RunRepositoriesSnapshotSchema,
      })
      const repositories = new Map(
        snapshot.repositories.map((repository) => [repository.repositoryId, repository]),
      )
      return prepared.map((workspace) => {
        const repository = repositories.get(workspace.repositoryId)
        if (repository === undefined) throw new Error('Captured repository was not found')
        return {
          ...repository,
          workspacePath: workspace.workspacePath,
          branchName: workspace.branchName,
        }
      })
    },
    async cleanup({ run, workspaces }) {
      const paths = options.paths.run(run.workflowId, run.runId)
      await requireDirectory(paths.directory, 'Run directory')
      if (await exists(paths.workspacesDirectory)) {
        await requireDirectory(paths.workspacesDirectory, 'Run workspaces directory')
        await rm(paths.workspacesDirectory, { recursive: true, force: true })
      }
      return workspaces.map(({ repositoryId }) => repositoryId)
    },
  }
}
