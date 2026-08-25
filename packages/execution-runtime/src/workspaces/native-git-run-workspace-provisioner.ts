import { lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
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
  readonly runs: Pick<
    RunRepository,
    | 'listRunRepositories'
    | 'listRunRepositoryWorkspaces'
    | 'markRunRepositoryWorkspacePreparing'
    | 'markRunRepositoryWorkspaceReady'
    | 'markRunRepositoryWorkspaceFailed'
    | 'markRunRepositoryWorkspaceCleaned'
  >
  readonly processRunner: ProcessRunner
  readonly workspacesRoot: string
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
    root: string,
  ): Promise<ProvisionedRunRepository> => {
    if (
      repository.provider === null ||
      repository.remoteId === null ||
      repository.defaultBranch === null
    ) {
      throw new GitWorkspaceError('Legacy local repositories cannot provision cloned workspaces')
    }
    const workspacePath = join(root, runId, repository.repositoryId)
    const branchName = `slopify/${runId}`
    if (
      state !== undefined &&
      (resolve(state.workspacePath) !== workspacePath ||
        (state.branchName !== null && state.branchName !== branchName))
    ) {
      throw new GitWorkspaceError('Persisted run repository workspace is not deterministic')
    }

    try {
      await requireCanonicalDirectory(root, 'Run workspaces root')
      const runDirectory = join(root, runId)
      if (await pathExists(runDirectory)) {
        await requireCanonicalDirectory(runDirectory, 'Run workspace directory')
      }
      if (
        state?.status === 'READY' &&
        (await verifyWorkspace(repository, workspacePath, branchName))
      ) {
        return { ...repository, workspacePath, branchName }
      }

      options.runs.markRunRepositoryWorkspacePreparing({
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
      options.runs.markRunRepositoryWorkspaceReady({
        runId,
        repositoryId: repository.repositoryId,
        workspacePath,
        branchName,
        timestamp: now(),
      })
      return { ...repository, workspacePath, branchName }
    } catch (cause) {
      const existing = options.runs
        .listRunRepositoryWorkspaces(runId)
        .find(({ repositoryId }) => repositoryId === repository.repositoryId)
      if (existing === undefined) {
        options.runs.markRunRepositoryWorkspacePreparing({
          runId,
          repositoryId: repository.repositoryId,
          workspacePath,
          branchName,
          timestamp: now(),
        })
      }
      options.runs.markRunRepositoryWorkspaceFailed({
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
    const repositories = options.runs.listRunRepositories(runId)
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
    const states = new Map<RepositoryId, RunRepositoryWorkspace>(
      options.runs.listRunRepositoryWorkspaces(runId).map((state) => [state.repositoryId, state]),
    )
    const workspaces: ProvisionedRunRepository[] = []
    const failures: RunWorkspaceProvisioningFailure[] = []
    for (const repository of repositories) {
      try {
        workspaces.push(
          await prepareRepository(runId, repository, states.get(repository.repositoryId), root),
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
    const runDirectory = join(root, runId)
    if (await pathExists(runDirectory)) await rm(runDirectory, { recursive: true, force: true })
    const timestamp = now()
    for (const workspace of options.runs.listRunRepositoryWorkspaces(runId)) {
      if (workspace.status === 'LEGACY') continue
      options.runs.markRunRepositoryWorkspaceCleaned({
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
