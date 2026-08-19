import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  VerificationNodeOutputSchema,
  createVerificationNodeExecutor,
  type NodeExecutionContext,
  type ProcessRunResult,
  type ProcessRunner,
} from '../../src/index.js'
import {
  TEST_RUN_ID,
  TEST_TIMESTAMP,
  createPersistenceFixture,
  createRun,
} from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const exited = (exitCode: number, stdout: string, stderr = ''): ProcessRunResult => ({
  status: 'exited',
  exitCode,
  signal: undefined,
  durationMs: 25,
  stdout,
  stderr,
  stdoutTruncated: false,
  stderrTruncated: false,
})

const createFixture = (results: readonly ProcessRunResult[]) => {
  const persistence = createPersistenceFixture()
  fixtures.push(persistence)
  const runRecord = createRun(persistence)
  persistence.runs.changeStatus({
    runId: TEST_RUN_ID,
    expectedStatus: 'PENDING',
    status: 'RUNNING',
    timestamp: TEST_TIMESTAMP,
  })
  persistence.runs.selectRepositories({
    runId: TEST_RUN_ID,
    selectedAt: TEST_TIMESTAMP,
    selection: {
      selected: [
        { repositoryId: 'docs', rationale: 'Docs changed', responsibility: 'Verify docs' },
        { repositoryId: 'api', rationale: 'API changed', responsibility: 'Verify API' },
      ],
      excluded: [{ repositoryId: 'web', rationale: 'No web change' }],
    },
  })
  for (const [repositoryId, suffix] of [
    ['docs', 'd'],
    ['api', 'a'],
  ] as const) {
    persistence.runs.recordWorkspace({
      runId: TEST_RUN_ID,
      repositoryId,
      repositoryPath: `/workspace/${repositoryId}`,
      worktreePath: `/worktrees/${repositoryId}`,
      remote: 'origin',
      targetBranch: 'main',
      sourceBranch: `ai/task-1-${repositoryId}`,
      baseSha: suffix.repeat(40),
      createdAt: TEST_TIMESTAMP,
    })
  }
  const node = persistence.revision.nodes.find(({ id }) => id === 'verify')
  const run = persistence.runs.get(runRecord.runId)
  if (node?.type !== 'command' || run === undefined) {
    throw new Error('Verification fixture is invalid')
  }
  const processRun = vi.fn<ProcessRunner['run']>()
  for (const result of results) processRun.mockResolvedValueOnce(result)
  const executor = createVerificationNodeExecutor({
    runner: { run: processRun },
    profiles: persistence.profiles,
    runs: persistence.runs,
    sensitiveValues: ['provider-secret'],
    now: () => '2026-08-19T14:00:00Z',
  })
  const context: NodeExecutionContext = {
    run,
    workflow: persistence.revision,
    node,
    nodeExecutionId: 'node-execution-verify-01',
    signal: new AbortController().signal,
  }
  return { context, executor, persistence, processRun }
}

describe('verification node executor', () => {
  it('runs every selected repository check in profile order and routes all-pass evidence', async () => {
    const fixture = createFixture([exited(0, 'api passed'), exited(0, 'docs passed')])

    const result = await fixture.executor.execute(fixture.context)

    expect(fixture.processRun.mock.calls.map(([input]) => input)).toEqual([
      {
        executable: 'pnpm',
        arguments: ['test'],
        cwd: '/worktrees/api',
        timeoutMs: 1_800_000,
        signal: fixture.context.signal,
      },
      {
        executable: 'pnpm',
        arguments: ['lint'],
        cwd: '/worktrees/docs',
        timeoutMs: 1_800_000,
        signal: fixture.context.signal,
      },
    ])
    expect(result).toMatchObject({
      status: 'succeeded',
      outcome: 'passed',
      artifactIds: [],
      output: {
        commandId: 'verify-selected-repositories',
        repositories: [
          { repositoryId: 'api', profilePosition: 0, status: 'passed' },
          { repositoryId: 'docs', profilePosition: 2, status: 'passed' },
        ],
        totals: { commandCount: 2, passedCommandCount: 2, failedCommandCount: 0 },
      },
    })
    const output = (result as { readonly output: unknown }).output
    expect(VerificationNodeOutputSchema.parse(output)).toEqual(output)
  })

  it('keeps running after a failed check and routes complete sanitized evidence', async () => {
    const secret = 'provider-secret'
    const fixture = createFixture([
      exited(2, `api stdout ${secret}`, `api stderr ${secret}`),
      exited(0, 'docs passed'),
    ])

    const result = await fixture.executor.execute(fixture.context)

    expect(fixture.processRun).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      status: 'succeeded',
      outcome: 'failed-checks',
      output: {
        repositories: [
          {
            repositoryId: 'api',
            status: 'failed',
            commands: [
              {
                status: 'failed',
                processStatus: 'exited',
                exitCode: 2,
                stdout: 'api stdout [REDACTED]',
                stderr: 'api stderr [REDACTED]',
              },
            ],
          },
          { repositoryId: 'docs', status: 'passed', commands: [{ status: 'passed' }] },
        ],
      },
    })
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('fails before execution when the immutable selected workspaces are incomplete', async () => {
    const fixture = createFixture([exited(0, 'api passed')])
    const context = {
      ...fixture.context,
      run: { ...fixture.context.run, profileSnapshotId: 'missing-snapshot' },
    }

    const result = await fixture.executor.execute(context)

    expect(result).toEqual({
      status: 'failed',
      code: 'VERIFICATION_CONTEXT_INVALID',
      message: 'Verification context does not match the immutable selected workspaces',
    })
    expect(fixture.processRun).not.toHaveBeenCalled()
  })
})
