import { lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { RunIdSchema, type RepositoryId, type RunId } from '@slopify/contracts'

import type {
  RunRepositorySnapshot,
  RunRepositoryWorkspace,
  RunRepository,
} from '../persistence/run-repository.js'
import type { ProcessRunResult, ProcessRunner } from '../processes/process-runner.js'
import {
  RunWorkspaceProvisioningError,
  type ProvisionedRunRepository,
  type RunWorkspaceProvisioner,
  type RunWorkspaceProvisioningFailure,
} from './run-workspace-provisioner.js'

export interface CreateNativeGitRunWorkspaceProvisionerOptions {
  readonly runs: {
    listRunRepositories(
      runId: RunId,
    ): readonly RunRepositorySnapshot[] | Promise<readonly RunRepositorySnapshot[]>
    listRunRepositoryWorkspaces(
      runId: RunId,
    ): readonly RunRepositoryWorkspace[] | Promise<readonly RunRepositoryWorkspace[]>
    markRunRepositoryWorkspacePreparing(
      input: Parameters<RunRepository['markRunRepositoryWorkspacePreparing']>[0],
    ): unknown
    markRunRepositoryWorkspaceReady(
      input: Parameters<RunRepository['markRunRepositoryWorkspaceReady']>[0],
    ): unknown
    markRunRepositoryWorkspaceFailed(
      input: Parameters<RunRepository['markRunRepositoryWorkspaceFailed']>[0],
    ): unknown
    markRunRepositoryWorkspaceCleaned(
      input: Parameters<RunRepository['markRunRepositoryWorkspaceCleaned']>[0],
    ): unknown
  }
  readonly processRunner: ProcessRunner
  readonly workspacesRoot: string
  readonly resolveRunDirectory?: (runId: RunId) => string
  readonly credentialHelper: string
  readonly timeoutMs?: number
  readonly now?: () => string
}

class GitWorkspaceError extends Error {}

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
}

const requireCanonicalDirectory = async (path: string, label: string): Promise<void> => {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink()) throw new GitWorkspaceError(`${label} must not be a symbolic link`)
  if (!metadata.isDirectory()) throw new GitWorkspaceError(`${label} must be a directory`)
  if ((await realpath(path)) !== path)
    throw new GitWorkspaceError(`${label} path contains a symbolic link`)
}

const processFailure = (operation: string, result: ProcessRunResult): GitWorkspaceError => {
  if (result.status === 'exited') {
    const detail = result.stderr.trim() || result.stdout.trim()
    return new GitWorkspaceError(detail || `${operation} exited with code ${result.exitCode}`)
  }
  if (result.status === 'failed-to-start') {
    return new GitWorkspaceError(`${operation}: ${result.message}`)
  }
  if (result.status === 'termination-unconfirmed') {
    return new GitWorkspaceError(`${operation} ${result.reason} and termination was not confirmed`)
  }
  return new GitWorkspaceError(`${operation} ${result.status}`)
}

const successfulOutput = (operation: string, result: ProcessRunResult): string => {
  if (result.status !== 'exited' || result.exitCode !== 0) throw processFailure(operation, result)
  if (result.stdoutTruncated) throw new GitWorkspaceError(`${operation} produced truncated output`)
  return result.stdout.trim()
}

const boundedErrorMessage = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : 'Git workspace preparation failed'
  return (message.trim() || 'Git workspace preparation failed').slice(0, 4_096)
}

export const createNativeGitRunWorkspaceProvisioner = (
  options: CreateNativeGitRunWorkspaceProvisionerOptions,
): RunWorkspaceProvisioner => {
  if (!isAbsolute(options.workspacesRoot)) {
    throw new TypeError('workspacesRoot must be an absolute path')
  }
  if (options.credentialHelper.trim() === '') {
    throw new TypeError('credentialHelper must not be blank')
  }
  const workspacesRoot = resolve(options.workspacesRoot)
  const credentialHelper = options.credentialHelper
  const timeoutMs = options.timeoutMs ?? 120_000
  const now = options.now ?? (() => new Date().toISOString())
  const pendingByRun = new Map<RunId, Promise<unknown>>()
  let canonicalRoot: Promise<string> | undefined

  const getCanonicalRoot = (): Promise<string> => {
    canonicalRoot ??= mkdir(workspacesRoot, { recursive: true }).then(async () => {
      const metadata = await lstat(workspacesRoot)
      if (metadata.isSymbolicLink())
        throw new GitWorkspaceError('Run workspaces root must not be a symbolic link')
      if (!metadata.isDirectory())
        throw new GitWorkspaceError('Run workspaces root must be a directory')
      return realpath(workspacesRoot)
    })
    return canonicalRoot
  }

  const runGit = (cwd: string, arguments_: readonly string[], operation: string) =>
    options.processRunner
      .run({ executable: 'git', arguments: arguments_, cwd, timeoutMs })
      .then((result) => successfulOutput(operation, result))

  const verifyWorkspace = async (
    repository: RunRepositorySnapshot,
    workspacePath: string,
    branchName: string,
  ): Promise<boolean> => {
    if (!(await pathExists(workspacePath))) return false
    await requireCanonicalDirectory(workspacePath, 'Run repository workspace')
    const topLevel = resolve(
      await runGit(
        workspacePath,
        ['-C', workspacePath, 'rev-parse', '--show-toplevel'],
        'Git workspace inspection',
      ),
    )
    if (topLevel !== workspacePath)
      throw new GitWorkspaceError('Git workspace root is not deterministic')
    const branch = await runGit(
      workspacePath,
      ['-C', workspacePath, 'branch', '--show-current'],
      'Git branch inspection',
    )
    if (branch !== branchName)
      throw new GitWorkspaceError('Run workspace branch is not deterministic')
    const origin = await runGit(
      workspacePath,
      ['-C', workspacePath, 'remote', 'get-url', 'origin'],
      'Git origin inspection',
    )
    if (origin !== repository.cloneUrl) throw new GitWorkspaceError('Run workspace origin changed')
    return true
  }

  const prepareRepository = async (
    runId: RunId,
    repository: RunRepositorySnapshot,
    state: RunRepositoryWorkspace | undefined,
    runDirectory: string,
  ): Promise<ProvisionedRunRepository> => {
    if (
      repository.provider === null ||
      repository.remoteId === null ||
      repository.defaultBranch === null
    ) {
      throw new GitWorkspaceError('Legacy local repositories cannot provision cloned workspaces')
    }
    const workspacePath = join(runDirectory, repository.repositoryId)
    const branchName = `slopify/${runId}`
    if (
      state !== undefined &&
      (resolve(state.workspacePath) !== workspacePath ||
        (state.branchName !== null && state.branchName !== branchName))
    ) {
      throw new GitWorkspaceError('Persisted run repository workspace is not deterministic')
    }

    try {
      if (await pathExists(runDirectory)) {
        await requireCanonicalDirectory(runDirectory, 'Run workspace directory')
      }
      if (
        state?.status === 'READY' &&
        (await verifyWorkspace(repository, workspacePath, branchName))
      ) {
        return { ...repository, workspacePath, branchName }
      }

      await options.runs.markRunRepositoryWorkspacePreparing({
        runId,
        repositoryId: repository.repositoryId,
        workspacePath,
        branchName,
        timestamp: now(),
      })
      if (await pathExists(workspacePath)) await rm(workspacePath, { recursive: true, force: true })
      await mkdir(runDirectory, { recursive: true })
      await requireCanonicalDirectory(runDirectory, 'Run workspace directory')

      await runGit(
        runDirectory,
        [
          '-c',
          `credential.helper=${credentialHelper}`,
          'clone',
          '--no-checkout',
          '--origin',
          'origin',
          repository.cloneUrl,
          workspacePath,
        ],
        'Git clone',
      )
      await requireCanonicalDirectory(workspacePath, 'Run repository workspace')
      await runGit(
        workspacePath,
        ['-C', workspacePath, 'checkout', '-b', branchName, repository.baseSha],
        'Git run branch creation',
      )
      await runGit(
        workspacePath,
        ['-C', workspacePath, 'remote', 'set-url', 'origin', repository.cloneUrl],
        'Git origin configuration',
      )
      await runGit(
        workspacePath,
        ['-C', workspacePath, 'config', '--local', 'credential.helper', credentialHelper],
        'Git credential configuration',
      )
      await verifyWorkspace(repository, workspacePath, branchName)
      await options.runs.markRunRepositoryWorkspaceReady({
        runId,
        repositoryId: repository.repositoryId,
        workspacePath,
        branchName,
        timestamp: now(),
      })
      return { ...repository, workspacePath, branchName }
    } catch (cause) {
      const existing = (await options.runs.listRunRepositoryWorkspaces(runId)).find(
        ({ repositoryId }) => repositoryId === repository.repositoryId,
      )
      if (existing === undefined) {
        await options.runs.markRunRepositoryWorkspacePreparing({
          runId,
          repositoryId: repository.repositoryId,
          workspacePath,
          branchName,
          timestamp: now(),
        })
      }
      await options.runs.markRunRepositoryWorkspaceFailed({
        runId,
        repositoryId: repository.repositoryId,
        workspacePath,
        branchName,
        errorMessage: boundedErrorMessage(cause),
        timestamp: now(),
      })
      throw cause
    }
  }

  const prepareRun = async (runId: RunId): Promise<readonly ProvisionedRunRepository[]> => {
    const repositories = await options.runs.listRunRepositories(runId)
    let root: string
    try {
      root = await getCanonicalRoot()
    } catch (cause) {
      throw new RunWorkspaceProvisioningError(
        repositories.map(({ repositoryId }) => ({
          repositoryId,
          message: boundedErrorMessage(cause),
        })),
      )
    }
    const runDirectory = resolve(options.resolveRunDirectory?.(runId) ?? join(root, runId))
    const relativeRunDirectory = relative(root, runDirectory)
    if (
      relativeRunDirectory === '' ||
      relativeRunDirectory === '..' ||
      relativeRunDirectory.startsWith(`..${sep}`) ||
      isAbsolute(relativeRunDirectory)
    ) {
      throw new RunWorkspaceProvisioningError(
        repositories.map(({ repositoryId }) => ({
          repositoryId,
          message: 'Run workspace directory must stay inside the workspaces root',
        })),
      )
    }
    const states = new Map<RepositoryId, RunRepositoryWorkspace>(
      (await options.runs.listRunRepositoryWorkspaces(runId)).map((state) => [
        state.repositoryId,
        state,
      ]),
    )
    const workspaces: ProvisionedRunRepository[] = []
    const failures: RunWorkspaceProvisioningFailure[] = []
    for (const repository of repositories) {
      try {
        workspaces.push(
          await prepareRepository(
            runId,
            repository,
            states.get(repository.repositoryId),
            runDirectory,
          ),
        )
      } catch (cause) {
        failures.push({
          repositoryId: repository.repositoryId,
          message: boundedErrorMessage(cause),
        })
      }
    }
    if (failures.length > 0) throw new RunWorkspaceProvisioningError(failures)
    return workspaces
  }

  const cleanupRun = async (runId: RunId): Promise<void> => {
    const root = await getCanonicalRoot()
    await requireCanonicalDirectory(root, 'Run workspaces root')
    const runDirectory = resolve(options.resolveRunDirectory?.(runId) ?? join(root, runId))
    const relativeRunDirectory = relative(root, runDirectory)
    if (
      relativeRunDirectory === '' ||
      relativeRunDirectory === '..' ||
      relativeRunDirectory.startsWith(`..${sep}`) ||
      isAbsolute(relativeRunDirectory)
    ) {
      throw new GitWorkspaceError('Run workspace directory must stay inside the workspaces root')
    }
    if (await pathExists(runDirectory)) {
      await requireCanonicalDirectory(runDirectory, 'Run workspace directory')
    }
    if (await pathExists(runDirectory)) await rm(runDirectory, { recursive: true, force: true })
    const timestamp = now()
    for (const workspace of await options.runs.listRunRepositoryWorkspaces(runId)) {
      if (workspace.status === 'LEGACY') continue
      await options.runs.markRunRepositoryWorkspaceCleaned({
        runId,
        repositoryId: workspace.repositoryId,
        timestamp,
      })
    }
  }

  const serialize = <Value>(runId: RunId, operation: () => Promise<Value>): Promise<Value> => {
    const preceding = pendingByRun.get(runId)
    const current = (preceding ?? Promise.resolve()).catch(() => undefined).then(operation)
    pendingByRun.set(runId, current)
    void current
      .finally(() => {
        if (pendingByRun.get(runId) === current) pendingByRun.delete(runId)
      })
      .catch(() => undefined)
    return current
  }

  return {
    ensure(runIdInput) {
      const runId = RunIdSchema.parse(runIdInput)
      return serialize(runId, () => prepareRun(runId))
    },
    cleanup(runIdInput) {
      const runId = RunIdSchema.parse(runIdInput)
      return serialize(runId, () => cleanupRun(runId))
    },
  }
}
