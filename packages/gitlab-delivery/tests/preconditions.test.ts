import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createProcessRunner } from '@loop/execution-runtime'
import { afterEach, describe, expect, it } from 'vitest'

import { createFinalizationGitClient } from '../src/index.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

const git = (cwd: string, ...arguments_: string[]): string =>
  execFileSync('git', ['-C', cwd, ...arguments_], { encoding: 'utf8' }).trim()

const createRepository = () => {
  const root = mkdtempSync(join(tmpdir(), 'slopify-finalization-git-'))
  directories.push(root)
  const remotePath = join(root, 'api.git')
  const seedPath = join(root, 'seed')
  const repositoryPath = join(root, 'repository')
  const worktreePath = join(root, 'worktree')
  mkdirSync(seedPath)
  execFileSync('git', ['init', '--bare', remotePath])
  execFileSync('git', ['init', seedPath])
  git(seedPath, 'config', 'user.name', 'Slopify Test')
  git(seedPath, 'config', 'user.email', 'slopify@example.test')
  writeFileSync(join(seedPath, 'README.md'), 'baseline\n')
  git(seedPath, 'add', 'README.md')
  git(seedPath, 'commit', '-m', 'Baseline')
  git(seedPath, 'branch', '-M', 'main')
  git(seedPath, 'remote', 'add', 'origin', remotePath)
  git(seedPath, 'push', 'origin', 'main')
  execFileSync('git', ['clone', remotePath, repositoryPath])
  git(repositoryPath, 'config', 'user.name', 'Slopify Test')
  git(repositoryPath, 'config', 'user.email', 'slopify@example.test')
  const baseSha = git(repositoryPath, 'rev-parse', 'HEAD')
  git(repositoryPath, 'worktree', 'add', '-b', 'ai/cu-123-run-01', worktreePath, baseSha)
  writeFileSync(join(worktreePath, 'implementation.txt'), 'implementation\n')
  git(worktreePath, 'add', 'implementation.txt')
  git(worktreePath, 'commit', '-m', 'Implement validation')
  return {
    remotePath,
    workspace: {
      repositoryId: 'api',
      repositoryPath,
      worktreePath,
      remote: 'origin',
      targetBranch: 'main',
      sourceBranch: 'ai/cu-123-run-01',
      baseSha,
    },
  }
}

const createClient = () =>
  createFinalizationGitClient({
    processRunner: createProcessRunner({ maxOutputBytes: 64 * 1_024 }),
    commandTimeoutMs: 10_000,
  })

describe('Git finalization preconditions', () => {
  it('accepts a clean matching branch with committed work ahead of the exact base', async () => {
    const fixture = createRepository()

    const result = await createClient().inspect(fixture.workspace)

    expect(result).toMatchObject({
      status: 'succeeded',
      value: { headSha: git(fixture.workspace.worktreePath, 'rev-parse', 'HEAD') },
    })
    if (result.status !== 'succeeded') throw new Error('Expected inspection to succeed')
    expect(result.evidence).toHaveLength(6)
  })

  it('rejects a dirty worktree before delivery', async () => {
    const fixture = createRepository()
    writeFileSync(join(fixture.workspace.worktreePath, 'uncommitted.txt'), 'dirty\n')

    const result = await createClient().inspect(fixture.workspace)

    expect(result).toMatchObject({
      status: 'failed',
      failure: {
        evidence: {
          code: 'GIT_FINALIZATION_PRECONDITION_FAILED',
          repositoryId: 'api',
        },
      },
    })
  })

  it('rejects a worktree checked out on a different source branch', async () => {
    const fixture = createRepository()

    const result = await createClient().inspect({
      ...fixture.workspace,
      sourceBranch: 'ai/cu-123-different-run',
    })

    expect(result).toMatchObject({
      status: 'failed',
      failure: {
        evidence: {
          code: 'GIT_FINALIZATION_PRECONDITION_FAILED',
          repositoryId: 'api',
        },
      },
    })
  })

  it('rejects a clean worktree without a commit ahead of the exact base', async () => {
    const fixture = createRepository()
    git(fixture.workspace.worktreePath, 'reset', '--hard', fixture.workspace.baseSha)

    const result = await createClient().inspect(fixture.workspace)

    expect(result).toMatchObject({
      status: 'failed',
      failure: {
        evidence: {
          code: 'GIT_FINALIZATION_PRECONDITION_FAILED',
          repositoryId: 'api',
        },
      },
    })
  })

  it('pushes only the explicit source ref without force and records the remote head', async () => {
    const fixture = createRepository()
    const client = createClient()
    const expectedHead = git(fixture.workspace.worktreePath, 'rev-parse', 'HEAD')

    const result = await client.push(fixture.workspace)

    expect(result).toMatchObject({ status: 'succeeded', value: true })
    expect(git(fixture.remotePath, 'rev-parse', 'refs/heads/ai/cu-123-run-01')).toBe(expectedHead)
    if (result.status !== 'succeeded') throw new Error('Expected push to succeed')
    expect(result.evidence).toMatchObject({
      command: {
        executable: 'git',
        arguments: [
          '-C',
          fixture.workspace.worktreePath,
          'push',
          '--porcelain',
          '--',
          'origin',
          'refs/heads/ai/cu-123-run-01:refs/heads/ai/cu-123-run-01',
        ],
      },
    })
    expect(JSON.stringify(result.evidence)).not.toContain('force')
  })
})
