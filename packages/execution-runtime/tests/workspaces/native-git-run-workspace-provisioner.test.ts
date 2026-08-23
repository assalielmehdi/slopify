import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  RunWorkspaceProvisioningError,
  createNativeGitRunWorkspaceProvisioner,
  createProcessRunner,
  type ProcessRunner,
} from '../../src/index.js'
import { createPersistenceFixture, createTestAgentWorkflow } from '../persistence/test-fixture.js'

const timestamp = '2026-08-23T14:00:00Z'
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

const createDirectory = (name: string): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), `${name}-`)))
  directories.push(directory)
  return directory
}

const createRepository = (parent: string, name: string) => {
  const repositoryPath = join(parent, name)
  mkdirSync(repositoryPath, { recursive: true })
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', repositoryPath])
  execFileSync('git', ['-C', repositoryPath, 'config', 'user.email', 'test@slopify.local'])
  execFileSync('git', ['-C', repositoryPath, 'config', 'user.name', 'Slopify Test'])
  writeFileSync(join(repositoryPath, 'README.md'), `${name}\n`)
  execFileSync('git', ['-C', repositoryPath, 'add', 'README.md'])
  execFileSync('git', ['-C', repositoryPath, 'commit', '--quiet', '-m', 'initial'])
  return {
    repositoryPath,
    baseSha: execFileSync('git', ['-C', repositoryPath, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
  }
}

const createWorkflow = (projectIds: readonly string[]) =>
  createTestAgentWorkflow({
    createdAt: timestamp,
    projectIds,
    primaryProjectId: projectIds[0] ?? null,
  })

const createRun = (
  fixture: ReturnType<typeof createPersistenceFixture>,
  projects: readonly {
    projectId: string
    name: string
    repositoryPath: string
    baseSha: string
  }[],
) => {
  fixture.runs.create({
    runId: 'run-worktrees',
    workflowId: fixture.workflow.workflowId,
    workflowSnapshot: fixture.workflow,
    variables: {},
    createdAt: timestamp,
    projects: projects.map((project) => ({ ...project, sourceBranch: 'main' })),
  })
}

describe('native Git run workspace provisioner', () => {
  it('creates deterministic detached worktrees and serializes concurrent requests', async () => {
    const root = createDirectory('slopify-run-worktrees')
    const repositories = createDirectory('slopify-run-repositories')
    const project = createRepository(repositories, 'api')
    const fixture = createPersistenceFixture(createWorkflow(['project-api']))

    try {
      createRun(fixture, [{ projectId: 'project-api', name: 'API', ...project }])
      const provisioner = createNativeGitRunWorkspaceProvisioner({
        runs: fixture.runs,
        worktreesRoot: root,
        processRunner: createProcessRunner({ maxOutputBytes: 16_384 }),
        now: () => timestamp,
      })

      const [first, second] = await Promise.all([
        provisioner.ensure('run-worktrees'),
        provisioner.ensure('run-worktrees'),
      ])

      const expectedPath = join(root, 'run-worktrees', 'project-api')
      expect(first).toEqual(second)
      expect(first).toEqual([
        {
          projectId: 'project-api',
          position: 0,
          name: 'API',
          repositoryPath: project.repositoryPath,
          worktreePath: expectedPath,
          baseSha: project.baseSha,
          sourceBranch: 'main',
          isPrimary: true,
        },
      ])
      expect(
        execFileSync('git', ['-C', expectedPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      ).toBe(project.baseSha)
      expect(() =>
        execFileSync('git', ['-C', expectedPath, 'symbolic-ref', '-q', 'HEAD']),
      ).toThrow()
      expect(fixture.runs.listRunProjectWorktrees('run-worktrees')).toMatchObject([
        { projectId: 'project-api', status: 'READY', worktreePath: expectedPath },
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('accepts a registered ready worktree after its HEAD moves beyond the captured base', async () => {
    const root = createDirectory('slopify-run-worktrees')
    const repositories = createDirectory('slopify-run-repositories')
    const project = createRepository(repositories, 'api')
    const fixture = createPersistenceFixture(createWorkflow(['project-api']))

    try {
      createRun(fixture, [{ projectId: 'project-api', name: 'API', ...project }])
      const provisioner = createNativeGitRunWorkspaceProvisioner({
        runs: fixture.runs,
        worktreesRoot: root,
        processRunner: createProcessRunner({ maxOutputBytes: 16_384 }),
        now: () => timestamp,
      })
      const [workspace] = await provisioner.ensure('run-worktrees')
      if (workspace === undefined) throw new Error('Expected a worktree')

      writeFileSync(join(workspace.worktreePath, 'change.txt'), 'agent change\n')
      execFileSync('git', ['-C', workspace.worktreePath, 'add', 'change.txt'])
      execFileSync('git', ['-C', workspace.worktreePath, 'commit', '--quiet', '-m', 'agent change'])
      const changedHead = execFileSync('git', ['-C', workspace.worktreePath, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim()

      await expect(provisioner.ensure('run-worktrees')).resolves.toEqual([workspace])
      expect(
        execFileSync('git', ['-C', workspace.worktreePath, 'rev-parse', 'HEAD'], {
          encoding: 'utf8',
        }).trim(),
      ).toBe(changedHead)
      expect(changedHead).not.toBe(project.baseSha)

      rmSync(workspace.worktreePath, { force: true, recursive: true })
      await expect(provisioner.ensure('run-worktrees')).resolves.toEqual([workspace])
      expect(
        execFileSync('git', ['-C', workspace.worktreePath, 'rev-parse', 'HEAD'], {
          encoding: 'utf8',
        }).trim(),
      ).toBe(project.baseSha)
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects a registered ready worktree replaced by a symbolic link', async () => {
    const root = createDirectory('slopify-run-worktrees')
    const repositories = createDirectory('slopify-run-repositories')
    const relocated = createDirectory('slopify-relocated-worktree')
    const project = createRepository(repositories, 'api')
    const fixture = createPersistenceFixture(createWorkflow(['project-api']))

    try {
      createRun(fixture, [{ projectId: 'project-api', name: 'API', ...project }])
      const provisioner = createNativeGitRunWorkspaceProvisioner({
        runs: fixture.runs,
        worktreesRoot: root,
        processRunner: createProcessRunner({ maxOutputBytes: 16_384 }),
        now: () => timestamp,
      })
      const [workspace] = await provisioner.ensure('run-worktrees')
      if (workspace === undefined) throw new Error('Expected a worktree')

      const relocatedWorktree = join(relocated, 'api')
      renameSync(workspace.worktreePath, relocatedWorktree)
      symlinkSync(relocatedWorktree, workspace.worktreePath, 'dir')

      await expect(provisioner.ensure('run-worktrees')).rejects.toBeInstanceOf(
        RunWorkspaceProvisioningError,
      )
      expect(fixture.runs.listRunProjectWorktrees('run-worktrees')).toMatchObject([
        {
          projectId: 'project-api',
          status: 'FAILED',
          errorMessage: expect.stringContaining('symbolic link'),
        },
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects a registered ready worktree whose run directory is replaced by a link', async () => {
    const root = createDirectory('slopify-run-worktrees')
    const repositories = createDirectory('slopify-run-repositories')
    const relocated = createDirectory('slopify-relocated-run')
    const project = createRepository(repositories, 'api')
    const fixture = createPersistenceFixture(createWorkflow(['project-api']))

    try {
      createRun(fixture, [{ projectId: 'project-api', name: 'API', ...project }])
      const provisioner = createNativeGitRunWorkspaceProvisioner({
        runs: fixture.runs,
        worktreesRoot: root,
        processRunner: createProcessRunner({ maxOutputBytes: 16_384 }),
        now: () => timestamp,
      })
      const [workspace] = await provisioner.ensure('run-worktrees')
      if (workspace === undefined) throw new Error('Expected a worktree')

      const runDirectory = join(root, 'run-worktrees')
      const relocatedRunDirectory = join(relocated, 'run-worktrees')
      renameSync(runDirectory, relocatedRunDirectory)
      symlinkSync(relocatedRunDirectory, runDirectory, 'dir')

      await expect(provisioner.ensure('run-worktrees')).rejects.toBeInstanceOf(
        RunWorkspaceProvisioningError,
      )
      expect(fixture.runs.listRunProjectWorktrees('run-worktrees')).toMatchObject([
        {
          projectId: 'project-api',
          status: 'FAILED',
          errorMessage: expect.stringContaining('symbolic link'),
        },
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects a linked run directory before creating a worktree through it', async () => {
    const root = createDirectory('slopify-run-worktrees')
    const repositories = createDirectory('slopify-run-repositories')
    const relocated = createDirectory('slopify-relocated-run')
    const project = createRepository(repositories, 'api')
    const fixture = createPersistenceFixture(createWorkflow(['project-api']))
    const runDirectory = join(root, 'run-worktrees')
    symlinkSync(relocated, runDirectory, 'dir')

    try {
      createRun(fixture, [{ projectId: 'project-api', name: 'API', ...project }])
      const provisioner = createNativeGitRunWorkspaceProvisioner({
        runs: fixture.runs,
        worktreesRoot: root,
        processRunner: createProcessRunner({ maxOutputBytes: 16_384 }),
        now: () => timestamp,
      })

      await expect(provisioner.ensure('run-worktrees')).rejects.toBeInstanceOf(
        RunWorkspaceProvisioningError,
      )
      expect(existsSync(join(relocated, 'project-api'))).toBe(false)
      expect(fixture.runs.listRunProjectWorktrees('run-worktrees')).toMatchObject([
        {
          projectId: 'project-api',
          status: 'FAILED',
          errorMessage: expect.stringContaining('symbolic link'),
        },
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('retains successful worktrees and retries only failed or missing projects', async () => {
    const root = createDirectory('slopify-run-worktrees')
    const repositories = createDirectory('slopify-run-repositories')
    const api = createRepository(repositories, 'api')
    const web = createRepository(repositories, 'web')
    const fixture = createPersistenceFixture(createWorkflow(['project-api', 'project-web']))
    const nativeRunner = createProcessRunner({ maxOutputBytes: 16_384 })
    let failWebOnce = true
    const processRunner: ProcessRunner = {
      async run(input) {
        if (
          failWebOnce &&
          input.arguments.includes('add') &&
          input.arguments.includes(join(root, 'run-worktrees', 'project-web'))
        ) {
          failWebOnce = false
          mkdirSync(join(root, 'run-worktrees', 'project-web'))
          return {
            status: 'exited',
            exitCode: 1,
            signal: undefined,
            durationMs: 1,
            stdout: '',
            stderr: 'planned failure',
            stdoutTruncated: false,
            stderrTruncated: false,
          }
        }
        return nativeRunner.run(input)
      },
    }

    try {
      createRun(fixture, [
        { projectId: 'project-api', name: 'API', ...api },
        { projectId: 'project-web', name: 'Web', ...web },
      ])
      const provisioner = createNativeGitRunWorkspaceProvisioner({
        runs: fixture.runs,
        worktreesRoot: root,
        processRunner,
        now: () => timestamp,
      })

      await expect(provisioner.ensure('run-worktrees')).rejects.toBeInstanceOf(
        RunWorkspaceProvisioningError,
      )
      expect(fixture.runs.listRunProjectWorktrees('run-worktrees')).toMatchObject([
        { projectId: 'project-api', status: 'READY' },
        { projectId: 'project-web', status: 'FAILED', errorMessage: 'planned failure' },
      ])

      await expect(provisioner.ensure('run-worktrees')).resolves.toHaveLength(2)
      expect(fixture.runs.listRunProjectWorktrees('run-worktrees')).toMatchObject([
        { projectId: 'project-api', status: 'READY' },
        { projectId: 'project-web', status: 'READY', errorMessage: null },
      ])
    } finally {
      fixture.cleanup()
    }
  })
})
