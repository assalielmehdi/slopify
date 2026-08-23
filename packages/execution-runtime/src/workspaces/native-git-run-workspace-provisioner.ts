import { lstat, mkdir, realpath, rmdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { RunIdSchema, type ProjectId, type RunId } from '@slopify/contracts'

import type {
  RunProjectSnapshot,
  RunProjectWorktree,
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
    | 'listRunProjectWorktrees'
    | 'markRunProjectWorktreePreparing'
    | 'markRunProjectWorktreeReady'
    | 'markRunProjectWorktreeFailed'
  >
  readonly processRunner: ProcessRunner
  readonly worktreesRoot: string
  readonly timeoutMs?: number
  readonly now?: () => string
}

class GitWorktreeError extends Error {}

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
}

const processFailure = (operation: string, result: ProcessRunResult): GitWorktreeError => {
  if (result.status === 'exited') {
    const detail = result.stderr.trim() || result.stdout.trim()
    return new GitWorktreeError(detail || `${operation} exited with code ${result.exitCode}`)
  }
  if (result.status === 'failed-to-start') {
    return new GitWorktreeError(`${operation}: ${result.message}`)
  }
  if (result.status === 'termination-unconfirmed') {
    return new GitWorktreeError(`${operation} ${result.reason} and termination was not confirmed`)
  }
  return new GitWorktreeError(`${operation} ${result.status}`)
}

const requireSuccessfulOutput = (operation: string, result: ProcessRunResult): string => {
  if (result.status !== 'exited' || result.exitCode !== 0) throw processFailure(operation, result)
  if (result.stdoutTruncated) throw new GitWorktreeError(`${operation} produced truncated output`)
  return result.stdout
}

const registeredWorktreePaths = (output: string): ReadonlySet<string> =>
  new Set(
    output
      .split('\0')
      .filter((field) => field.startsWith('worktree '))
      .map((field) => resolve(field.slice('worktree '.length))),
  )

const requireCanonicalDirectory = async (path: string, label: string): Promise<void> => {
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink()) {
    throw new GitWorktreeError(`${label} must not be a symbolic link`)
  }
  if (!metadata.isDirectory()) {
    throw new GitWorktreeError(`${label} must be a directory`)
  }
  if ((await realpath(path)) !== path) {
    throw new GitWorktreeError(`${label} path contains a symbolic link`)
  }
}

const boundedErrorMessage = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : 'Git worktree preparation failed'
  return (message.trim() || 'Git worktree preparation failed').slice(0, 4_096)
}

export const createNativeGitRunWorkspaceProvisioner = (
  options: CreateNativeGitRunWorkspaceProvisionerOptions,
): RunWorkspaceProvisioner => {
  if (!isAbsolute(options.worktreesRoot)) {
    throw new TypeError('worktreesRoot must be an absolute path')
  }
  const worktreesRoot = resolve(options.worktreesRoot)
  const timeoutMs = options.timeoutMs ?? 30_000
  const now = options.now ?? (() => new Date().toISOString())
  const pendingByRun = new Map<RunId, Promise<readonly ProvisionedRunProject[]>>()
  let canonicalWorktreesRoot: Promise<string> | undefined

  const getCanonicalWorktreesRoot = (): Promise<string> => {
    canonicalWorktreesRoot ??= mkdir(worktreesRoot, { recursive: true }).then(() =>
      realpath(worktreesRoot),
    )
    return canonicalWorktreesRoot
  }

  const listRegisteredWorktrees = async (
    project: RunProjectSnapshot,
  ): Promise<ReadonlySet<string>> => {
    const result = await options.processRunner.run({
      executable: 'git',
      arguments: ['-C', project.repositoryPath, 'worktree', 'list', '--porcelain', '-z'],
      cwd: project.repositoryPath,
      timeoutMs,
    })
    return registeredWorktreePaths(requireSuccessfulOutput('Git worktree inspection', result))
  }

  const prepareProject = async (
    runId: RunId,
    project: RunProjectSnapshot,
    state: RunProjectWorktree | undefined,
    canonicalRoot: string,
  ): Promise<ProvisionedRunProject> => {
    const worktreePath = join(canonicalRoot, runId, project.projectId)
    if (state !== undefined && resolve(state.worktreePath) !== worktreePath) {
      throw new GitWorktreeError('Persisted run project worktree path is not deterministic')
    }

    try {
      await requireCanonicalDirectory(canonicalRoot, 'Run worktrees root')
      const runDirectory = dirname(worktreePath)
      if (await pathExists(runDirectory)) {
        await requireCanonicalDirectory(runDirectory, 'Run worktree directory')
      }
    } catch (cause) {
      if (state === undefined) {
        options.runs.markRunProjectWorktreePreparing({
          runId,
          projectId: project.projectId,
          worktreePath,
          timestamp: now(),
        })
      }
      options.runs.markRunProjectWorktreeFailed({
        runId,
        projectId: project.projectId,
        worktreePath,
        errorMessage: boundedErrorMessage(cause),
        timestamp: now(),
      })
      throw cause
    }

    let registered: ReadonlySet<string>
    try {
      registered = await listRegisteredWorktrees(project)
    } catch (cause) {
      if (state === undefined) {
        options.runs.markRunProjectWorktreePreparing({
          runId,
          projectId: project.projectId,
          worktreePath,
          timestamp: now(),
        })
      }
      options.runs.markRunProjectWorktreeFailed({
        runId,
        projectId: project.projectId,
        worktreePath,
        errorMessage: boundedErrorMessage(cause),
        timestamp: now(),
      })
      throw cause
    }

    const exists = await pathExists(worktreePath)
    if (exists) {
      try {
        await requireCanonicalDirectory(worktreePath, 'Run project worktree')
      } catch (cause) {
        options.runs.markRunProjectWorktreeFailed({
          runId,
          projectId: project.projectId,
          worktreePath,
          errorMessage: boundedErrorMessage(cause),
          timestamp: now(),
        })
        throw cause
      }
    }
    if (registered.has(worktreePath) && exists) {
      if (state?.status !== 'READY') {
        options.runs.markRunProjectWorktreePreparing({
          runId,
          projectId: project.projectId,
          worktreePath,
          timestamp: now(),
        })
        options.runs.markRunProjectWorktreeReady({
          runId,
          projectId: project.projectId,
          worktreePath,
          timestamp: now(),
        })
      }
      return { ...project, worktreePath }
    }

    if (!registered.has(worktreePath) && exists) {
      try {
        if (state?.status !== 'FAILED' && state?.status !== 'PREPARING') {
          throw new GitWorktreeError(
            'The deterministic worktree path exists but is not registered to the project repository',
          )
        }
        await rmdir(worktreePath)
      } catch (cause) {
        if (state === undefined) {
          options.runs.markRunProjectWorktreePreparing({
            runId,
            projectId: project.projectId,
            worktreePath,
            timestamp: now(),
          })
        }
        options.runs.markRunProjectWorktreeFailed({
          runId,
          projectId: project.projectId,
          worktreePath,
          errorMessage: boundedErrorMessage(cause),
          timestamp: now(),
        })
        throw cause
      }
    }

    if (state?.status === 'READY') {
      options.runs.markRunProjectWorktreeFailed({
        runId,
        projectId: project.projectId,
        worktreePath,
        errorMessage: 'The ready worktree is no longer registered',
        timestamp: now(),
      })
    }
    options.runs.markRunProjectWorktreePreparing({
      runId,
      projectId: project.projectId,
      worktreePath,
      timestamp: now(),
    })

    try {
      await mkdir(dirname(worktreePath), { recursive: true })
      await requireCanonicalDirectory(dirname(worktreePath), 'Run worktree directory')
      if (registered.has(worktreePath)) {
        const removal = await options.processRunner.run({
          executable: 'git',
          arguments: ['-C', project.repositoryPath, 'worktree', 'remove', '--force', worktreePath],
          cwd: project.repositoryPath,
          timeoutMs,
        })
        requireSuccessfulOutput('Missing Git worktree registration removal', removal)
      }
      const result = await options.processRunner.run({
        executable: 'git',
        arguments: [
          '-C',
          project.repositoryPath,
          'worktree',
          'add',
          '--detach',
          worktreePath,
          project.baseSha,
        ],
        cwd: project.repositoryPath,
        timeoutMs,
      })
      requireSuccessfulOutput('Git worktree creation', result)

      const updatedRegistration = await listRegisteredWorktrees(project)
      if (!updatedRegistration.has(worktreePath)) {
        throw new GitWorktreeError('Git did not register the created run project worktree')
      }
      await requireCanonicalDirectory(worktreePath, 'Run project worktree')
      options.runs.markRunProjectWorktreeReady({
        runId,
        projectId: project.projectId,
        worktreePath,
        timestamp: now(),
      })
      return { ...project, worktreePath }
    } catch (cause) {
      options.runs.markRunProjectWorktreeFailed({
        runId,
        projectId: project.projectId,
        worktreePath,
        errorMessage: boundedErrorMessage(cause),
        timestamp: now(),
      })
      throw cause
    }
  }

  const prepareRun = async (runId: RunId): Promise<readonly ProvisionedRunProject[]> => {
    const canonicalRoot = await getCanonicalWorktreesRoot()
    const projects = options.runs.listRunProjects(runId)
    const states = new Map<ProjectId, RunProjectWorktree>(
      options.runs.listRunProjectWorktrees(runId).map((state) => [state.projectId, state]),
    )
    const workspaces: ProvisionedRunProject[] = []
    const failures: RunWorkspaceProvisioningFailure[] = []

    for (const project of projects) {
      try {
        workspaces.push(
          await prepareProject(runId, project, states.get(project.projectId), canonicalRoot),
        )
      } catch (cause) {
        failures.push({ projectId: project.projectId, message: boundedErrorMessage(cause) })
      }
    }
    if (failures.length > 0) throw new RunWorkspaceProvisioningError(failures)
    return workspaces
  }

  return {
    ensure(runIdInput) {
      const runId = RunIdSchema.parse(runIdInput)
      const preceding = pendingByRun.get(runId)
      const operation = (preceding ?? Promise.resolve([]))
        .catch(() => [])
        .then(() => prepareRun(runId))
      pendingByRun.set(runId, operation)
      void operation.then(
        () => {
          if (pendingByRun.get(runId) === operation) pendingByRun.delete(runId)
        },
        () => {
          if (pendingByRun.get(runId) === operation) pendingByRun.delete(runId)
        },
      )
      return operation
    },
  }
}
