import { lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { RunIdSchema, type ProjectId, type RunId } from '@slopify/contracts'

import type {
  RunProjectSnapshot,
  RunProjectWorkspace,
  RunRepository,
} from '../persistence/run-repository.js'
import type { ProcessRunResult, ProcessRunner } from '../processes/process-runner.js'
import {
  RunWorkspaceProvisioningError,
  type ProvisionedRunProject,
  type RunWorkspaceProvisioner,
  type RunWorkspaceProvisioningFailure,
} from './run-workspace-provisioner.js'

export interface CreateNativeGitRunWorkspaceProvisionerOptions {
  readonly runs: Pick<
    RunRepository,
    | 'listRunProjects'
    | 'listRunProjectWorkspaces'
    | 'markRunProjectWorkspacePreparing'
    | 'markRunProjectWorkspaceReady'
    | 'markRunProjectWorkspaceFailed'
    | 'markRunProjectWorkspaceCleaned'
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
    project: RunProjectSnapshot,
    workspacePath: string,
    branchName: string,
  ): Promise<boolean> => {
    if (!(await pathExists(workspacePath))) return false
    await requireCanonicalDirectory(workspacePath, 'Run project workspace')
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
    if (origin !== project.cloneUrl) throw new GitWorkspaceError('Run workspace origin changed')
    return true
  }

  const prepareProject = async (
    runId: RunId,
    project: RunProjectSnapshot,
    state: RunProjectWorkspace | undefined,
    root: string,
  ): Promise<ProvisionedRunProject> => {
    if (project.provider === null || project.remoteId === null || project.defaultBranch === null) {
      throw new GitWorkspaceError('Legacy local projects cannot provision cloned workspaces')
    }
    const workspacePath = join(root, runId, project.projectId)
    const branchName = `slopify/${runId}`
    if (
      state !== undefined &&
      (resolve(state.workspacePath) !== workspacePath ||
        (state.branchName !== null && state.branchName !== branchName))
    ) {
      throw new GitWorkspaceError('Persisted run project workspace is not deterministic')
    }

    try {
      await requireCanonicalDirectory(root, 'Run workspaces root')
      const runDirectory = join(root, runId)
      if (await pathExists(runDirectory)) {
        await requireCanonicalDirectory(runDirectory, 'Run workspace directory')
      }
      if (
        state?.status === 'READY' &&
        (await verifyWorkspace(project, workspacePath, branchName))
      ) {
        return { ...project, workspacePath, branchName }
      }

      options.runs.markRunProjectWorkspacePreparing({
        runId,
        projectId: project.projectId,
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
          project.cloneUrl,
          workspacePath,
        ],
        'Git clone',
      )
      await requireCanonicalDirectory(workspacePath, 'Run project workspace')
      await runGit(
        workspacePath,
        ['-C', workspacePath, 'checkout', '-b', branchName, project.baseSha],
        'Git run branch creation',
      )
      await runGit(
        workspacePath,
        ['-C', workspacePath, 'remote', 'set-url', 'origin', project.cloneUrl],
        'Git origin configuration',
      )
      await runGit(
        workspacePath,
        ['-C', workspacePath, 'config', '--local', 'credential.helper', credentialHelper],
        'Git credential configuration',
      )
      await verifyWorkspace(project, workspacePath, branchName)
      options.runs.markRunProjectWorkspaceReady({
        runId,
        projectId: project.projectId,
        workspacePath,
        branchName,
        timestamp: now(),
      })
      return { ...project, workspacePath, branchName }
    } catch (cause) {
      const existing = options.runs
        .listRunProjectWorkspaces(runId)
        .find(({ projectId }) => projectId === project.projectId)
      if (existing === undefined) {
        options.runs.markRunProjectWorkspacePreparing({
          runId,
          projectId: project.projectId,
          workspacePath,
          branchName,
          timestamp: now(),
        })
      }
      options.runs.markRunProjectWorkspaceFailed({
        runId,
        projectId: project.projectId,
        workspacePath,
        branchName,
        errorMessage: boundedErrorMessage(cause),
        timestamp: now(),
      })
      throw cause
    }
  }

  const prepareRun = async (runId: RunId): Promise<readonly ProvisionedRunProject[]> => {
    const projects = options.runs.listRunProjects(runId)
    let root: string
    try {
      root = await getCanonicalRoot()
    } catch (cause) {
      throw new RunWorkspaceProvisioningError(
        projects.map(({ projectId }) => ({ projectId, message: boundedErrorMessage(cause) })),
      )
    }
    const states = new Map<ProjectId, RunProjectWorkspace>(
      options.runs.listRunProjectWorkspaces(runId).map((state) => [state.projectId, state]),
    )
    const workspaces: ProvisionedRunProject[] = []
    const failures: RunWorkspaceProvisioningFailure[] = []
    for (const project of projects) {
      try {
        workspaces.push(await prepareProject(runId, project, states.get(project.projectId), root))
      } catch (cause) {
        failures.push({ projectId: project.projectId, message: boundedErrorMessage(cause) })
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
    for (const workspace of options.runs.listRunProjectWorkspaces(runId)) {
      if (workspace.status === 'LEGACY') continue
      options.runs.markRunProjectWorkspaceCleaned({
        runId,
        projectId: workspace.projectId,
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
