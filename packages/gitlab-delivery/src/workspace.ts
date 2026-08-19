import { lstat, mkdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import {
  GitWorkspaceSchema,
  PrepareGitWorkspacesInputSchema,
  type GitWorkspace,
  type PrepareGitWorkspacesInput,
  type RunId,
} from '@loop/contracts'
import type {
  ProcessRunner,
  ProfileRepositorySnapshot,
  RecordWorkspaceInput,
  RunWorkspace,
} from '@loop/execution-runtime'

import {
  createGitClient,
  type GitClient,
  type GitCommandFailure,
  type GitOperation,
} from './git.js'

export interface WorkspaceProfileStore {
  getSnapshot(snapshotId: string):
    | Readonly<{
        profileId: string
        repositories: readonly ProfileRepositorySnapshot[]
      }>
    | undefined
}

export interface WorkspaceRunStore {
  get(runId: RunId): Readonly<{ profileSnapshotId: string }> | undefined
  listSelections(runId: RunId): readonly Readonly<{
    repositoryId: string
    profilePosition: number
    rationale: string
    responsibility: string
  }>[]
  listWorkspaces(runId: RunId): readonly RunWorkspace[]
  recordWorkspace(input: RecordWorkspaceInput): void
}

export type WorkspacePreparationErrorCode =
  | 'GIT_BRANCH_COLLISION'
  | 'GIT_BRANCH_INVALID'
  | 'GIT_FETCH_FAILED'
  | 'GIT_REMOTE_INVALID'
  | 'GIT_REPOSITORY_INVALID'
  | 'GIT_TARGET_INVALID'
  | 'GIT_TARGET_RESOLUTION_FAILED'
  | 'GIT_WORKTREE_COLLISION'
  | 'GIT_WORKTREE_CREATE_FAILED'
  | 'PERSISTENCE_FAILED'
  | 'PREPARATION_INPUT_INVALID'
  | 'PROFILE_SNAPSHOT_MISSING'
  | 'REPOSITORY_SELECTION_MISMATCH'
  | 'RUN_NOT_FOUND'
  | 'WORKSPACE_ALREADY_RECORDED'

export interface WorkspacePreparationError {
  readonly code: WorkspacePreparationErrorCode
  readonly message: string
  readonly repositoryId?: string
  readonly commandFailure?: GitCommandFailure
}

export type WorkspacePreparationResult =
  | Readonly<{ status: 'succeeded'; workspaces: readonly GitWorkspace[] }>
  | Readonly<{
      status: 'failed'
      error: WorkspacePreparationError
      partialWorkspaces: readonly GitWorkspace[]
    }>

export interface WorkspacePreparer {
  prepareWorkspaces(input: PrepareGitWorkspacesInput): Promise<WorkspacePreparationResult>
}

export interface CreateWorkspacePreparerOptions {
  readonly profiles: WorkspaceProfileStore
  readonly runs: WorkspaceRunStore
  readonly processRunner: ProcessRunner
  readonly commandTimeoutMs?: number
  readonly now?: () => string
}

const normalizeBranchValue = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')

const shortRunId = (runId: string): string => {
  const withoutPrefix = runId.startsWith('run-') ? runId.slice(4) : runId
  return normalizeBranchValue(withoutPrefix).slice(0, 8)
}

export const renderSourceBranch = (template: string, taskId: string, runId: string): string => {
  const task = normalizeBranchValue(taskId)
  const run = shortRunId(runId)
  const rendered = template.replaceAll('{task}', task).replaceAll('{run}', run)
  if (task === '' || run === '' || rendered.includes('{') || rendered.includes('}')) {
    throw new TypeError('Branch template could not be rendered')
  }
  return rendered
}

export const resolveWorktreePath = (
  worktreeParent: string,
  runId: string,
  repositoryId: string,
): string => join(worktreeParent, runId, repositoryId)

const gitErrorCode = (operation: GitOperation): WorkspacePreparationErrorCode => {
  switch (operation) {
    case 'add-worktree':
      return 'GIT_WORKTREE_CREATE_FAILED'
    case 'branch-exists':
      return 'GIT_BRANCH_INVALID'
    case 'fetch-target':
      return 'GIT_FETCH_FAILED'
    case 'remote-url':
      return 'GIT_REMOTE_INVALID'
    case 'repository-root':
      return 'GIT_REPOSITORY_INVALID'
    case 'resolve-target':
      return 'GIT_TARGET_RESOLUTION_FAILED'
    case 'validate-ref':
      return 'GIT_TARGET_INVALID'
  }
}

const failed = (
  code: WorkspacePreparationErrorCode,
  message: string,
  partialWorkspaces: readonly GitWorkspace[],
  options?: Readonly<{ repositoryId?: string; commandFailure?: GitCommandFailure }>,
): WorkspacePreparationResult => ({
  status: 'failed',
  error: {
    code,
    message,
    ...(options?.repositoryId === undefined ? {} : { repositoryId: options.repositoryId }),
    ...(options?.commandFailure === undefined ? {} : { commandFailure: options.commandFailure }),
  },
  partialWorkspaces: [...partialWorkspaces],
})

const fromGitFailure = (
  repositoryId: string,
  commandFailure: GitCommandFailure,
  partialWorkspaces: readonly GitWorkspace[],
  overrideCode?: WorkspacePreparationErrorCode,
): WorkspacePreparationResult =>
  failed(
    overrideCode ?? gitErrorCode(commandFailure.operation),
    `Git workspace preparation failed for repository ${repositoryId}`,
    partialWorkspaces,
    { repositoryId, commandFailure },
  )

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
}

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

const workspaceWithoutPosition = (workspace: RunWorkspace): GitWorkspace =>
  GitWorkspaceSchema.parse({
    repositoryId: workspace.repositoryId,
    repositoryPath: workspace.repositoryPath,
    worktreePath: workspace.worktreePath,
    remote: workspace.remote,
    targetBranch: workspace.targetBranch,
    sourceBranch: workspace.sourceBranch,
    baseSha: workspace.baseSha,
  })

const prepareRepository = async (
  git: GitClient,
  input: PrepareGitWorkspacesInput,
  repository: ProfileRepositorySnapshot,
  partialWorkspaces: readonly GitWorkspace[],
): Promise<WorkspacePreparationResult | GitWorkspace> => {
  const repositoryId = repository.repositoryId
  if (
    !isAbsolute(repository.repositoryPath) ||
    !isAbsolute(repository.worktreeParent) ||
    !(await isDirectory(repository.repositoryPath)) ||
    !(await isDirectory(repository.worktreeParent))
  ) {
    return failed(
      'GIT_REPOSITORY_INVALID',
      `Repository paths are invalid for repository ${repositoryId}`,
      partialWorkspaces,
      { repositoryId },
    )
  }

  const root = await git.repositoryRoot(repository.repositoryPath)
  if (root.status === 'failed') return fromGitFailure(repositoryId, root.failure, partialWorkspaces)
  let configuredRoot: string
  let resolvedRoot: string
  try {
    ;[configuredRoot, resolvedRoot] = await Promise.all([
      realpath(repository.repositoryPath),
      realpath(root.value),
    ])
  } catch {
    return failed(
      'GIT_REPOSITORY_INVALID',
      `Repository root is invalid for repository ${repositoryId}`,
      partialWorkspaces,
      { repositoryId },
    )
  }
  if (configuredRoot !== resolvedRoot) {
    return failed(
      'GIT_REPOSITORY_INVALID',
      `Repository path is not the configured Git root for repository ${repositoryId}`,
      partialWorkspaces,
      { repositoryId },
    )
  }

  const remote = await git.remoteUrl(repository.repositoryPath, repository.remote)
  if (remote.status === 'failed') {
    return fromGitFailure(repositoryId, remote.failure, partialWorkspaces)
  }
  const target = await git.validateRef(repository.repositoryPath, repository.targetBranch)
  if (target.status === 'failed') {
    return fromGitFailure(repositoryId, target.failure, partialWorkspaces, 'GIT_TARGET_INVALID')
  }

  let sourceBranch: string
  try {
    sourceBranch = renderSourceBranch(repository.branchTemplate, input.taskId, input.runId)
  } catch {
    return failed(
      'GIT_BRANCH_INVALID',
      `Source branch is invalid for repository ${repositoryId}`,
      partialWorkspaces,
      { repositoryId },
    )
  }
  const source = await git.validateRef(repository.repositoryPath, sourceBranch)
  if (source.status === 'failed') {
    return fromGitFailure(repositoryId, source.failure, partialWorkspaces, 'GIT_BRANCH_INVALID')
  }
  const branch = await git.branchExists(repository.repositoryPath, sourceBranch)
  if (branch.status === 'failed') {
    return fromGitFailure(repositoryId, branch.failure, partialWorkspaces, 'GIT_BRANCH_INVALID')
  }
  if (branch.value) {
    return failed(
      'GIT_BRANCH_COLLISION',
      `Source branch already exists for repository ${repositoryId}`,
      partialWorkspaces,
      { repositoryId },
    )
  }

  const worktreePath = resolveWorktreePath(repository.worktreeParent, input.runId, repositoryId)
  if (await pathExists(worktreePath)) {
    return failed(
      'GIT_WORKTREE_COLLISION',
      `Worktree path already exists for repository ${repositoryId}`,
      partialWorkspaces,
      { repositoryId },
    )
  }

  const fetched = await git.fetchTarget(
    repository.repositoryPath,
    repository.remote,
    repository.targetBranch,
  )
  if (fetched.status === 'failed') {
    return fromGitFailure(repositoryId, fetched.failure, partialWorkspaces)
  }
  const resolvedTarget = await git.resolveTarget(
    repository.repositoryPath,
    repository.remote,
    repository.targetBranch,
  )
  if (resolvedTarget.status === 'failed') {
    return fromGitFailure(repositoryId, resolvedTarget.failure, partialWorkspaces)
  }
  await mkdir(dirname(worktreePath), { recursive: true })
  const created = await git.addWorktree(
    repository.repositoryPath,
    worktreePath,
    sourceBranch,
    resolvedTarget.value,
  )
  if (created.status === 'failed') {
    return fromGitFailure(repositoryId, created.failure, partialWorkspaces)
  }

  try {
    return GitWorkspaceSchema.parse({
      repositoryId,
      repositoryPath: resolve(repository.repositoryPath),
      worktreePath: resolve(worktreePath),
      remote: repository.remote,
      targetBranch: repository.targetBranch,
      sourceBranch,
      baseSha: resolvedTarget.value,
    })
  } catch {
    return failed(
      'GIT_TARGET_RESOLUTION_FAILED',
      `Fetched target identity is invalid for repository ${repositoryId}`,
      partialWorkspaces,
      { repositoryId },
    )
  }
}

export const createWorkspacePreparer = (
  options: CreateWorkspacePreparerOptions,
): WorkspacePreparer => {
  const git = createGitClient({
    processRunner: options.processRunner,
    commandTimeoutMs: options.commandTimeoutMs ?? 30_000,
  })
  const now = options.now ?? (() => new Date().toISOString())

  return {
    async prepareWorkspaces(inputValue) {
      const parsed = PrepareGitWorkspacesInputSchema.safeParse(inputValue)
      if (!parsed.success) {
        return failed('PREPARATION_INPUT_INVALID', 'Workspace preparation input is invalid', [])
      }
      const input = parsed.data
      const run = options.runs.get(input.runId)
      if (run === undefined) return failed('RUN_NOT_FOUND', 'Run was not found', [])
      const profile = options.profiles.getSnapshot(run.profileSnapshotId)
      if (profile === undefined || profile.profileId !== input.profileId) {
        return failed('PROFILE_SNAPSHOT_MISSING', 'Run profile snapshot was not found', [])
      }
      const existing = options.runs.listWorkspaces(input.runId).map(workspaceWithoutPosition)
      if (existing.length > 0) {
        return failed(
          'WORKSPACE_ALREADY_RECORDED',
          'Run workspaces have already been recorded',
          existing,
        )
      }

      const expectedIds = new Set(input.selectedRepositoryIds)
      const persistedIds = new Set(
        options.runs.listSelections(input.runId).map(({ repositoryId }) => repositoryId),
      )
      if (
        expectedIds.size !== persistedIds.size ||
        [...expectedIds].some((repositoryId) => !persistedIds.has(repositoryId))
      ) {
        return failed(
          'REPOSITORY_SELECTION_MISMATCH',
          'Selected repositories do not match the persisted selection',
          [],
        )
      }
      const selectedRepositories = [...profile.repositories]
        .sort((left, right) => left.profilePosition - right.profilePosition)
        .filter(({ repositoryId }) => expectedIds.has(repositoryId))
      if (selectedRepositories.length !== expectedIds.size) {
        return failed(
          'REPOSITORY_SELECTION_MISMATCH',
          'Selected repositories are unavailable in the profile snapshot',
          [],
        )
      }

      const workspaces: GitWorkspace[] = []
      for (const repository of selectedRepositories) {
        const prepared = await prepareRepository(git, input, repository, workspaces)
        if ('status' in prepared) return prepared
        try {
          options.runs.recordWorkspace({
            runId: input.runId,
            repositoryId: prepared.repositoryId,
            repositoryPath: prepared.repositoryPath,
            worktreePath: prepared.worktreePath,
            remote: prepared.remote,
            targetBranch: prepared.targetBranch,
            sourceBranch: prepared.sourceBranch,
            baseSha: prepared.baseSha,
            createdAt: now(),
          })
        } catch {
          return failed(
            'PERSISTENCE_FAILED',
            `Workspace could not be recorded for repository ${repository.repositoryId}`,
            workspaces,
            { repositoryId: repository.repositoryId },
          )
        }
        workspaces.push(prepared)
      }
      return { status: 'succeeded', workspaces }
    },
  }
}
