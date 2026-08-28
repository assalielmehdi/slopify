import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkflowFile } from '@slopify/workflow-model'
import { afterEach, describe, expect, it } from 'vitest'

import {
  RunWorkspaceProvisioningError,
  RunWorkspacesProjectionSchema,
  calculateResourceRevision,
  createFilesystemGitRunWorkspaceProvisioner,
  createFilesystemJournalCoordinatorStore,
  createFilesystemRunJournal,
  createFilesystemRunStore,
  createJournalWorkflowCoordinator,
  createProcessRunner,
  createRunRecoveryService,
  resolveSlopifyPaths,
  type ProcessRunner,
} from '../../src/index.js'

const timestamp = '2026-08-25T10:00:00.000Z'
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

const temporaryDirectory = (name: string): string => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), `${name}-`)))
  directories.push(directory)
  return directory
}

const createRemote = () => {
  const parent = temporaryDirectory('slopify-filesystem-remote')
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

const workflow: WorkflowFile = {
  schemaVersion: 3,
  workflowId: 'workspace-review',
  description: 'Exercise run-local clones.',
  repositories: {
    repositoryIds: ['repository-api'],
    primaryRepositoryId: 'repository-api',
  },
  variables: [],
  graph: {
    startNodeId: 'review',
    nodes: [
      {
        type: 'agent',
        id: 'review',
        name: 'Review',
        prompt: 'Review the change.',
        harness: { harnessId: 'pi' },
        timeoutSeconds: 900,
      },
    ],
    edges: [],
    maxTransitions: 0,
  },
  createdAt: timestamp,
  updatedAt: timestamp,
}

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

const createFixture = async () => {
  const home = temporaryDirectory('slopify-filesystem-workspaces')
  const remote = createRemote()
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  await createFilesystemRunStore({ paths }).admit({
    runId: 'run-01',
    workflowId: workflow.workflowId,
    createdAt: timestamp,
    workflowSnapshot: {
      schemaVersion: 1,
      capturedAt: timestamp,
      workflowRevision: calculateResourceRevision('workspace workflow'),
      workflow,
    },
    variablesSnapshot: { schemaVersion: 1, values: {} },
    repositoriesSnapshot: {
      schemaVersion: 1,
      repositories: [
        {
          repositoryId: 'repository-api',
          position: 0,
          name: 'API',
          provider: 'GITHUB',
          remoteId: '123',
          fullName: 'operator/api',
          cloneUrl: 'https://github.com/operator/api.git',
          webUrl: 'https://github.com/operator/api',
          defaultBranch: 'main',
          baseSha: remote.baseSha,
          isPrimary: true,
        },
      ],
    },
    verifySource: async () => undefined,
  })
  const provisioner = createFilesystemGitRunWorkspaceProvisioner({
    paths,
    credentialHelper: '!bun /opt/slopify/git-credential-helper.js',
    processRunner: localCloneRunner(remote.remote),
    now: () => timestamp,
  })
  return {
    paths,
    provisioner,
    locator: { workflowId: workflow.workflowId, runId: 'run-01' },
  }
}

describe('filesystem Git run workspace provisioner', () => {
  it('creates and verifies an isolated clone inside the durable run directory', async () => {
    const fixture = await createFixture()
    const [first, second] = await Promise.all([
      fixture.provisioner.ensure(fixture.locator),
      fixture.provisioner.ensure(fixture.locator),
    ])
    const runPaths = fixture.paths.run(workflow.workflowId, 'run-01')
    const workspacePath = join(runPaths.workspacesDirectory, 'repository-api')

    expect(first).toEqual(second)
    expect(first).toMatchObject([{ workspacePath, branchName: 'slopify/run-01' }])
    expect(
      execFileSync('git', ['-C', workspacePath, 'branch', '--show-current'], {
        encoding: 'utf8',
      }).trim(),
    ).toBe('slopify/run-01')
    expect(
      RunWorkspacesProjectionSchema.parse(JSON.parse(readFileSync(runPaths.workspacesFile, 'utf8')))
        .workspaces,
    ).toMatchObject([{ repositoryId: 'repository-api', status: 'READY', workspacePath }])

    const journal = createFilesystemRunJournal({
      ...fixture.locator,
      paths: fixture.paths,
    })
    await journal.append({ eventId: 'run-started', timestamp, type: 'RUN_STARTED', data: {} })
    await journal.append({ eventId: 'run-succeeded', timestamp, type: 'RUN_SUCCEEDED', data: {} })
    const coordinatorStore = createFilesystemJournalCoordinatorStore({ paths: fixture.paths })
    const runs = {
      ...coordinatorStore,
      async list() {
        return [fixture.locator]
      },
    }
    await createRunRecoveryService({
      runs,
      coordinator: createJournalWorkflowCoordinator({
        runs,
        workspaces: fixture.provisioner,
        now: () => timestamp,
      }),
      worker: { drain: async () => 0 },
      workspaces: fixture.provisioner,
      now: () => timestamp,
    }).recover()

    expect(existsSync(runPaths.workspacesDirectory)).toBe(false)
    expect(existsSync(runPaths.workspacesFile)).toBe(true)
    expect(
      RunWorkspacesProjectionSchema.parse(JSON.parse(readFileSync(runPaths.workspacesFile, 'utf8')))
        .workspaces,
    ).toMatchObject([{ repositoryId: 'repository-api', status: 'CLEANED' }])
  })

  it('rejects a linked run-local workspaces directory', async () => {
    const fixture = await createFixture()
    const runPaths = fixture.paths.run(workflow.workflowId, 'run-01')
    const relocated = temporaryDirectory('slopify-relocated-workspaces')
    rmSync(runPaths.workspacesDirectory, { recursive: true })
    symlinkSync(relocated, runPaths.workspacesDirectory, 'dir')

    await expect(fixture.provisioner.ensure(fixture.locator)).rejects.toBeInstanceOf(
      RunWorkspaceProvisioningError,
    )
    expect(existsSync(join(relocated, 'repository-api'))).toBe(false)
  })
})
