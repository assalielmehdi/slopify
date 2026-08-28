import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
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
import { createRuntimeFixture, createTestAgentWorkflow } from '../support/runtime-fixture.js'

const timestamp = '2026-08-24T00:00:00Z'
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

const createDirectory = (name: string): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), `${name}-`)))
  directories.push(directory)
  return directory
}

const createRemote = () => {
  const parent = createDirectory('slopify-remote')
  const source = join(parent, 'source')
  const remote = join(parent, 'api.git')
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', source])
  execFileSync('git', ['-C', source, 'config', 'user.email', 'test@slopify.local'])
  execFileSync('git', ['-C', source, 'config', 'user.name', 'Slopify Test'])
  writeFileSync(join(source, 'README.md'), 'api\n')
  execFileSync('git', ['-C', source, 'add', 'README.md'])
  execFileSync('git', ['-C', source, 'commit', '--quiet', '-m', 'initial'])
  execFileSync('git', ['clone', '--quiet', '--bare', source, remote])
  return {
    remote,
    baseSha: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
  }
}

const createRun = (
  fixture: ReturnType<typeof createRuntimeFixture>,
  runId: string,
  baseSha: string,
) =>
  fixture.runs.create({
    runId,
    workflowId: fixture.workflow.workflowId,
    workflowSnapshot: fixture.workflow,
    variables: {},
    createdAt: timestamp,
    repositories: [
      {
        repositoryId: 'repository-api',
        name: 'API',
        provider: 'GITHUB',
        remoteId: '123',
        fullName: 'operator/api',
        cloneUrl: 'https://github.com/operator/api.git',
        defaultBranch: 'main',
        baseSha,
      },
    ],
  })

const localCloneRunner = (remote: string): ProcessRunner => {
  const native = createProcessRunner({ maxOutputBytes: 16_384 })
  return {
    run(input) {
      const arguments_ = input.arguments.includes('clone')
        ? input.arguments.map((argument) =>
            argument === 'https://github.com/operator/api.git' ? remote : argument,
          )
        : input.arguments
      return native.run({ ...input, arguments: arguments_ })
    },
  }
}

describe('native Git run workspace provisioner', () => {
  it('creates one deterministic clone and branch shared by every agent in a run', async () => {
    const root = createDirectory('slopify-workspaces')
    const remote = createRemote()
    const workflow = createTestAgentWorkflow({
      createdAt: timestamp,
      repositoryIds: ['repository-api'],
      primaryRepositoryId: 'repository-api',
    })
    const fixture = createRuntimeFixture(workflow)

    try {
      createRun(fixture, 'run-clone', remote.baseSha)
      const provisioner = createNativeGitRunWorkspaceProvisioner({
        runs: fixture.runs,
        workspacesRoot: root,
        credentialHelper: '!bun /opt/slopify/git-credential-helper.js',
        processRunner: localCloneRunner(remote.remote),
        now: () => timestamp,
      })

      const [first, second] = await Promise.all([
        provisioner.ensure('run-clone'),
        provisioner.ensure('run-clone'),
      ])
      const workspacePath = join(root, 'run-clone', 'repository-api')
      expect(first).toEqual(second)
      expect(first).toMatchObject([
        {
          workspacePath,
          branchName: 'slopify/run-clone',
          baseSha: remote.baseSha,
        },
      ])
      expect(
        execFileSync('git', ['-C', workspacePath, 'branch', '--show-current'], {
          encoding: 'utf8',
        }).trim(),
      ).toBe('slopify/run-clone')
      expect(
        execFileSync('git', ['-C', workspacePath, 'config', '--local', 'credential.helper'], {
          encoding: 'utf8',
        }).trim(),
      ).toBe('!bun /opt/slopify/git-credential-helper.js')

      writeFileSync(join(workspacePath, 'agent-change.txt'), 'visible to the next agent\n')
      await expect(provisioner.ensure('run-clone')).resolves.toEqual(first)
      expect(existsSync(join(workspacePath, 'agent-change.txt'))).toBe(true)
    } finally {
      fixture.cleanup()
    }
  })

  it('isolates concurrent runs in different clones and branches', async () => {
    const root = createDirectory('slopify-workspaces')
    const remote = createRemote()
    const workflow = createTestAgentWorkflow({
      createdAt: timestamp,
      repositoryIds: ['repository-api'],
      primaryRepositoryId: 'repository-api',
    })
    const fixture = createRuntimeFixture(workflow)

    try {
      createRun(fixture, 'run-one', remote.baseSha)
      createRun(fixture, 'run-two', remote.baseSha)
      const provisioner = createNativeGitRunWorkspaceProvisioner({
        runs: fixture.runs,
        workspacesRoot: root,
        credentialHelper: '!bun /opt/slopify/git-credential-helper.js',
        processRunner: localCloneRunner(remote.remote),
      })

      const [[one], [two]] = await Promise.all([
        provisioner.ensure('run-one'),
        provisioner.ensure('run-two'),
      ])
      expect(one?.workspacePath).not.toBe(two?.workspacePath)
      expect(one?.branchName).toBe('slopify/run-one')
      expect(two?.branchName).toBe('slopify/run-two')
    } finally {
      fixture.cleanup()
    }
  })

  it('cleans the deterministic run directory and persists cleaned state', async () => {
    const root = createDirectory('slopify-workspaces')
    const remote = createRemote()
    const workflow = createTestAgentWorkflow({
      createdAt: timestamp,
      repositoryIds: ['repository-api'],
      primaryRepositoryId: 'repository-api',
    })
    const fixture = createRuntimeFixture(workflow)

    try {
      createRun(fixture, 'run-cleanup', remote.baseSha)
      const provisioner = createNativeGitRunWorkspaceProvisioner({
        runs: fixture.runs,
        workspacesRoot: root,
        credentialHelper: '!bun /opt/slopify/git-credential-helper.js',
        processRunner: localCloneRunner(remote.remote),
        now: () => timestamp,
      })
      await provisioner.ensure('run-cleanup')

      await provisioner.cleanup('run-cleanup')

      expect(existsSync(join(root, 'run-cleanup'))).toBe(false)
      expect(fixture.runs.listRunRepositoryWorkspaces('run-cleanup')).toMatchObject([
        { status: 'CLEANED', cleanedAt: timestamp },
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects a linked deterministic run directory', async () => {
    const root = createDirectory('slopify-workspaces')
    const relocated = createDirectory('slopify-relocated')
    const remote = createRemote()
    const workflow = createTestAgentWorkflow({
      createdAt: timestamp,
      repositoryIds: ['repository-api'],
      primaryRepositoryId: 'repository-api',
    })
    const fixture = createRuntimeFixture(workflow)
    mkdirSync(root, { recursive: true })
    symlinkSync(relocated, join(root, 'run-linked'), 'dir')

    try {
      createRun(fixture, 'run-linked', remote.baseSha)
      const provisioner = createNativeGitRunWorkspaceProvisioner({
        runs: fixture.runs,
        workspacesRoot: root,
        credentialHelper: '!bun /opt/slopify/git-credential-helper.js',
        processRunner: localCloneRunner(remote.remote),
      })

      await expect(provisioner.ensure('run-linked')).rejects.toBeInstanceOf(
        RunWorkspaceProvisioningError,
      )
      expect(existsSync(join(relocated, 'repository-api'))).toBe(false)
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects a linked workspaces root', async () => {
    const parent = createDirectory('slopify-workspaces-parent')
    const relocated = createDirectory('slopify-relocated-root')
    const linkedRoot = join(parent, 'workspaces')
    symlinkSync(relocated, linkedRoot, 'dir')
    const remote = createRemote()
    const workflow = createTestAgentWorkflow({
      createdAt: timestamp,
      repositoryIds: ['repository-api'],
      primaryRepositoryId: 'repository-api',
    })
    const fixture = createRuntimeFixture(workflow)

    try {
      createRun(fixture, 'run-linked-root', remote.baseSha)
      const provisioner = createNativeGitRunWorkspaceProvisioner({
        runs: fixture.runs,
        workspacesRoot: linkedRoot,
        credentialHelper: '!bun /opt/slopify/git-credential-helper.js',
        processRunner: localCloneRunner(remote.remote),
      })

      await expect(provisioner.ensure('run-linked-root')).rejects.toBeInstanceOf(
        RunWorkspaceProvisioningError,
      )
      expect(existsSync(join(relocated, 'run-linked-root'))).toBe(false)
    } finally {
      fixture.cleanup()
    }
  })
})
