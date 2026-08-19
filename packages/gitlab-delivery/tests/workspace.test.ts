import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createProcessRunner, type RunWorkspace } from '@loop/execution-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createWorkspacePreparer,
  renderSourceBranch,
  resolveWorktreePath,
  type WorkspaceProfileStore,
  type WorkspaceRunStore,
} from '../src/index.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

const git = (cwd: string, ...arguments_: string[]): string =>
  execFileSync('git', ['-C', cwd, ...arguments_], { encoding: 'utf8' }).trim()

interface GitRepositoryFixture {
  readonly repositoryId: string
  readonly repositoryPath: string
  readonly remotePath: string
  readonly seedPath: string
  readonly worktreeParent: string
}

const createGitRepository = (root: string, repositoryId: string): GitRepositoryFixture => {
  const remotePath = join(root, `${repositoryId}.git`)
  const seedPath = join(root, `${repositoryId}-seed`)
  const repositoryPath = join(root, repositoryId)
  const worktreeParent = join(root, 'worktrees')
  mkdirSync(worktreeParent, { recursive: true })
  execFileSync('git', ['init', '--bare', remotePath])
  execFileSync('git', ['init', seedPath])
  git(seedPath, 'config', 'user.name', 'Slopify Test')
  git(seedPath, 'config', 'user.email', 'slopify@example.test')
  writeFileSync(join(seedPath, 'README.md'), `${repositoryId}\n`)
  git(seedPath, 'add', 'README.md')
  git(seedPath, 'commit', '-m', 'Initial commit')
  git(seedPath, 'branch', '-M', 'main')
  git(seedPath, 'remote', 'add', 'origin', remotePath)
  git(seedPath, 'push', '-u', 'origin', 'main')
  git(remotePath, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  execFileSync('git', ['clone', remotePath, repositoryPath])
  git(repositoryPath, 'config', 'user.name', 'Slopify Test')
  git(repositoryPath, 'config', 'user.email', 'slopify@example.test')
  git(repositoryPath, 'checkout', '-b', 'operator-local')
  writeFileSync(join(repositoryPath, 'operator-note.txt'), 'keep me dirty\n')
  return { repositoryId, repositoryPath, remotePath, seedPath, worktreeParent }
}

const pushRemoteCommit = (repository: GitRepositoryFixture, sequence: number): string => {
  writeFileSync(join(repository.seedPath, `change-${sequence}.txt`), `change ${sequence}\n`)
  git(repository.seedPath, 'add', `change-${sequence}.txt`)
  git(repository.seedPath, 'commit', '-m', `Remote change ${sequence}`)
  git(repository.seedPath, 'push', 'origin', 'main')
  return git(repository.seedPath, 'rev-parse', 'HEAD')
}

const sourceState = (repositoryPath: string) => ({
  branch: git(repositoryPath, 'branch', '--show-current'),
  head: git(repositoryPath, 'rev-parse', 'HEAD'),
  status: git(repositoryPath, 'status', '--porcelain=v1'),
})

const profileRepository = (repository: GitRepositoryFixture, profilePosition: number) => ({
  repositoryId: repository.repositoryId,
  profilePosition,
  displayName: repository.repositoryId,
  purpose: `${repository.repositoryId} test repository`,
  repositoryPath: repository.repositoryPath,
  gitlabProject: `group/${repository.repositoryId}`,
  remote: 'origin',
  targetBranch: 'main',
  worktreeParent: repository.worktreeParent,
  branchTemplate: 'ai/{task}-{run}',
  executableChecks: [],
  verificationCommands: [],
  mergeRequestLabels: [],
})

const createFixture = (
  repositories: readonly GitRepositoryFixture[],
  selectedRepositoryIds: readonly string[],
) => {
  const recorded: RunWorkspace[] = []
  const profiles: WorkspaceProfileStore = {
    getSnapshot: vi.fn(() => ({
      snapshotId: 'snapshot-01',
      profileId: 'profile-01',
      displayName: 'Test profile',
      clickupWorkspaceId: 'workspace-01',
      clickupListId: 'list-01',
      clickupInReviewStatusId: 'in-review',
      createdAt: '2026-08-19T09:00:00Z',
      repositories: repositories.map(profileRepository),
    })),
  }
  const runs: WorkspaceRunStore = {
    get: vi.fn(() => ({ profileSnapshotId: 'snapshot-01' })),
    listSelections: vi.fn(() =>
      [...selectedRepositoryIds].reverse().map((repositoryId, index) => ({
        repositoryId,
        profilePosition: selectedRepositoryIds.length - index - 1,
        rationale: 'Selected by test',
        responsibility: 'Implement the task',
      })),
    ),
    listWorkspaces: vi.fn(() => recorded),
    recordWorkspace: vi.fn((workspace) => {
      recorded.push({ ...workspace, profilePosition: recorded.length })
    }),
  }
  const preparer = createWorkspacePreparer({
    profiles,
    runs,
    processRunner: createProcessRunner({ maxOutputBytes: 64 * 1_024 }),
    commandTimeoutMs: 10_000,
    now: () => '2026-08-19T10:00:00Z',
  })
  return { preparer, recorded, runs }
}

const preparationInput = (selectedRepositoryIds: readonly string[]) => ({
  runId: 'run-12345678-abcd-4000-8000-123456789abc',
  taskId: 'TASK-1',
  profileId: 'profile-01',
  selectedRepositoryIds,
})

describe('ordered Git workspace preparation', () => {
  it('fetches exact targets and records selected worktrees in profile order without touching source checkouts', async () => {
    const root = join(tmpdir(), `slopify-workspace-${crypto.randomUUID()}`)
    directories.push(root)
    mkdirSync(root, { recursive: true })
    const api = createGitRepository(root, 'api')
    const web = createGitRepository(root, 'web')
    const docs = createGitRepository(root, 'docs')
    const expectedBases = new Map([
      ['api', pushRemoteCommit(api, 1)],
      ['web', pushRemoteCommit(web, 1)],
    ])
    const initialStates = new Map(
      [api, web, docs].map((repository) => [
        repository.repositoryId,
        sourceState(repository.repositoryPath),
      ]),
    )
    const docsRefs = git(docs.repositoryPath, 'show-ref')
    const { preparer, recorded } = createFixture([api, web, docs], ['api', 'web'])

    const result = await preparer.prepareWorkspaces(preparationInput(['web', 'api']))

    expect(result).toMatchObject({ status: 'succeeded' })
    if (result.status !== 'succeeded') throw new Error('Expected preparation to succeed')
    expect(result.workspaces.map(({ repositoryId }) => repositoryId)).toEqual(['api', 'web'])
    expect(recorded.map(({ repositoryId }) => repositoryId)).toEqual(['api', 'web'])
    for (const workspace of result.workspaces) {
      expect(workspace.baseSha).toBe(expectedBases.get(workspace.repositoryId))
      expect(git(workspace.worktreePath, 'rev-parse', 'HEAD')).toBe(workspace.baseSha)
      expect(git(workspace.worktreePath, 'branch', '--show-current')).toBe(workspace.sourceBranch)
    }
    for (const repository of [api, web, docs]) {
      expect(sourceState(repository.repositoryPath)).toEqual(
        initialStates.get(repository.repositoryId),
      )
    }
    expect(git(docs.repositoryPath, 'show-ref')).toBe(docsRefs)
  })

  it('stops at a later branch collision while preserving the earlier persisted worktree', async () => {
    const root = join(tmpdir(), `slopify-workspace-${crypto.randomUUID()}`)
    directories.push(root)
    mkdirSync(root, { recursive: true })
    const api = createGitRepository(root, 'api')
    const web = createGitRepository(root, 'web')
    pushRemoteCommit(api, 1)
    pushRemoteCommit(web, 1)
    const input = preparationInput(['api', 'web'])
    const sourceBranch = renderSourceBranch('ai/{task}-{run}', input.taskId, input.runId)
    git(web.repositoryPath, 'branch', sourceBranch)
    const initialStates = new Map(
      [api, web].map((repository) => [
        repository.repositoryId,
        sourceState(repository.repositoryPath),
      ]),
    )
    const { preparer, recorded } = createFixture([api, web], ['api', 'web'])

    const result = await preparer.prepareWorkspaces(input)

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'GIT_BRANCH_COLLISION', repositoryId: 'web' },
      partialWorkspaces: [{ repositoryId: 'api' }],
    })
    expect(recorded.map(({ repositoryId }) => repositoryId)).toEqual(['api'])
    expect(existsSync(resolveWorktreePath(api.worktreeParent, input.runId, 'api'))).toBe(true)
    expect(existsSync(resolveWorktreePath(web.worktreeParent, input.runId, 'web'))).toBe(false)
    for (const repository of [api, web]) {
      expect(sourceState(repository.repositoryPath)).toEqual(
        initialStates.get(repository.repositoryId),
      )
    }
  })

  it('rejects a worktree path collision without reusing it or creating the source branch', async () => {
    const root = join(tmpdir(), `slopify-workspace-${crypto.randomUUID()}`)
    directories.push(root)
    mkdirSync(root, { recursive: true })
    const api = createGitRepository(root, 'api')
    const input = preparationInput(['api'])
    const worktreePath = resolveWorktreePath(api.worktreeParent, input.runId, 'api')
    mkdirSync(worktreePath, { recursive: true })
    const { preparer, recorded } = createFixture([api], ['api'])

    const result = await preparer.prepareWorkspaces(input)

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'GIT_WORKTREE_COLLISION', repositoryId: 'api' },
      partialWorkspaces: [],
    })
    expect(recorded).toEqual([])
    const sourceBranch = renderSourceBranch('ai/{task}-{run}', input.taskId, input.runId)
    expect(() =>
      git(api.repositoryPath, 'show-ref', '--verify', `refs/heads/${sourceBranch}`),
    ).toThrow()
  })
})
