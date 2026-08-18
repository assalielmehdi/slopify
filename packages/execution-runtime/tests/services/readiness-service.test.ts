import type { ProcessRunInput, ProcessRunResult, ProcessRunner } from '../../src/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createProjectProfileService } from '../../src/services/project-profile-service.js'
import { createReadinessService } from '../../src/services/readiness-service.js'
import { TEST_PROFILE, createPersistenceFixture } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const exited = (stdout = '', exitCode = 0): ProcessRunResult => ({
  status: 'exited',
  exitCode,
  signal: undefined,
  durationMs: 1,
  stdout,
  stderr: '',
  stdoutTruncated: false,
  stderrTruncated: false,
})

const createFixture = (runImplementation: (input: ProcessRunInput) => ProcessRunResult) => {
  const fixture = createPersistenceFixture()
  fixtures.push(fixture)
  const profile = {
    ...TEST_PROFILE,
    repositories: [
      {
        ...TEST_PROFILE.repositories[0],
        repositoryPath: '/workspace/api',
        worktreeParent: '/workspace/.worktrees',
        executableChecks: [
          {
            executable: 'node',
            arguments: ['--version'],
            expectedOutputIncludes: 'v24.',
          },
        ],
      },
    ],
  }
  const profiles = createProjectProfileService({
    profiles: fixture.profiles,
    runtimeMode: 'container',
    workspaceRoot: '/workspace',
    now: () => '2026-08-18T22:00:00Z',
  })
  profiles.save(profile)
  const run = vi.fn(async (input: ProcessRunInput) => runImplementation(input))
  const processRunner: ProcessRunner = { run }
  return { fixture, profiles, processRunner, run }
}

describe('project profile readiness', () => {
  it('passes non-mutating Git and configured tool checks in deterministic order', async () => {
    const { profiles, processRunner, run } = createFixture((input) => {
      if (input.arguments.includes('get-url')) return exited('git@gitlab.example:group/api.git\n')
      if (input.arguments.includes('show-ref')) return exited()
      return exited('v24.18.0\n')
    })
    const readiness = createReadinessService({
      profiles,
      processRunner,
      filesystem: { isDirectory: () => true, isReadable: () => true, isWritable: () => true },
      connectors: () => ({ clickup: true, gitlab: true, modelProvider: true }),
      commandTimeoutMs: 1_000,
    })

    const result = await readiness.check('profile-01')

    expect(result).toMatchObject({ ready: true, repositories: [{ repositoryId: 'api' }] })
    expect(result.repositories[0]?.findings).toEqual([])
    expect(run.mock.calls.map(([input]) => [input.executable, input.arguments])).toEqual([
      ['git', ['-C', '/workspace/api', 'remote', 'get-url', 'origin']],
      [
        'git',
        ['-C', '/workspace/api', 'show-ref', '--quiet', '--verify', 'refs/remotes/origin/main'],
      ],
      ['node', ['--version']],
    ])
  })

  it('returns repository-addressable filesystem and connector findings without running commands', async () => {
    const { profiles, processRunner, run } = createFixture(() => exited())
    const readiness = createReadinessService({
      profiles,
      processRunner,
      filesystem: { isDirectory: () => false, isReadable: () => false, isWritable: () => false },
      connectors: () => ({ clickup: false, gitlab: false, modelProvider: false }),
    })

    const result = await readiness.check('profile-01')

    expect(result.ready).toBe(false)
    expect(
      result.repositories[0]?.findings.map(({ category, code }) => ({ category, code })),
    ).toEqual([
      { category: 'filesystem', code: 'REPOSITORY_PATH_MISSING' },
      { category: 'filesystem', code: 'WORKTREE_PARENT_MISSING' },
      { category: 'clickup', code: 'CLICKUP_UNAVAILABLE' },
      { category: 'gitlab', code: 'GITLAB_UNAVAILABLE' },
      { category: 'model-provider', code: 'MODEL_PROVIDER_UNAVAILABLE' },
    ])
    expect(JSON.stringify(result)).not.toContain('token')
    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'wrong remote',
      implementation: (input: ProcessRunInput) =>
        input.arguments.includes('get-url')
          ? exited('git@gitlab.example:other/api.git\n')
          : exited(),
      expectedCode: 'GIT_REMOTE_MISMATCH',
    },
    {
      name: 'missing executable',
      implementation: (input: ProcessRunInput) =>
        input.executable === 'node'
          ? ({
              ...exited(),
              status: 'failed-to-start' as const,
              code: 'ENOENT',
              message: 'Process could not be started' as const,
            } satisfies ProcessRunResult)
          : input.arguments.includes('get-url')
            ? exited('git@gitlab.example:group/api.git\n')
            : exited(),
      expectedCode: 'TOOL_UNAVAILABLE',
    },
    {
      name: 'incompatible version',
      implementation: (input: ProcessRunInput) =>
        input.executable === 'node'
          ? exited('v22.0.0\n')
          : input.arguments.includes('get-url')
            ? exited('git@gitlab.example:group/api.git\n')
            : exited(),
      expectedCode: 'TOOL_VERSION_MISMATCH',
    },
  ])('reports a $name with sanitized stable evidence', async ({ implementation, expectedCode }) => {
    const { profiles, processRunner } = createFixture(implementation)
    const readiness = createReadinessService({
      profiles,
      processRunner,
      filesystem: { isDirectory: () => true, isReadable: () => true, isWritable: () => true },
      connectors: () => ({ clickup: true, gitlab: true, modelProvider: true }),
    })

    const result = await readiness.check('profile-01')

    expect(result.ready).toBe(false)
    expect(result.repositories[0]?.findings).toContainEqual(
      expect.objectContaining({ code: expectedCode }),
    )
  })
})
