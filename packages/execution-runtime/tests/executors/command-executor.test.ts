import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createRegisteredCommandExecutors,
  type NodeExecutionContext,
  type ProcessRunResult,
  type ProcessRunner,
} from '../../src/index.js'
import { createPersistenceFixture, createRun } from '../persistence/test-fixture.js'
import { createSimpleWorkflow } from '../engine/test-workflows.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const exited = (exitCode: number): ProcessRunResult => ({
  status: 'exited',
  exitCode,
  signal: undefined,
  durationMs: 12,
  stdout: 'verification output',
  stderr: 'verification warning',
  stdoutTruncated: false,
  stderrTruncated: false,
})

const createContext = (): NodeExecutionContext => {
  const workflow = createSimpleWorkflow()
  const fixture = createPersistenceFixture(workflow)
  fixtures.push(fixture)
  const run = createRun(fixture, {
    clickupDescription: 'node -e "this must remain inert"',
  })
  const node = workflow.nodes[0]
  if (node?.type !== 'command') throw new Error('Expected a command fixture node')

  return {
    run,
    workflow,
    node,
    nodeExecutionId: 'node-execution-01',
    signal: new AbortController().signal,
  }
}

const createFixture = (result: ProcessRunResult) => {
  const run = vi.fn(async () => result)
  const runner: ProcessRunner = { run }
  const executors = createRegisteredCommandExecutors({
    runner,
    commands: {
      'start-command': {
        executable: '/opt/loop/bin/verify',
        arguments: ['check', '--format=json'],
        cwd: '/workspace/repository',
        exitCodeOutcomes: { 0: 'done', 2: 'blocked' },
      },
    },
  })
  const executor = executors['start-command']
  if (executor === undefined) throw new Error('Expected a registered command executor')
  return { executor, run }
}

describe('registered command executor', () => {
  it('runs only its application-owned executable and argument array', async () => {
    const { executor, run } = createFixture(exited(0))
    const context = createContext()

    const result = await executor.execute(context)

    expect(run).toHaveBeenCalledWith({
      executable: '/opt/loop/bin/verify',
      arguments: ['check', '--format=json'],
      cwd: '/workspace/repository',
      timeoutMs: 1_000,
      signal: context.signal,
    })
    expect(result).toEqual({
      status: 'succeeded',
      outcome: 'done',
      artifactIds: [],
      output: {
        commandId: 'start-command',
        exitCode: 0,
        durationMs: 12,
        stdout: 'verification output',
        stderr: 'verification warning',
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    })
  })

  it('refuses a mismatched workflow command instead of running the registered process', async () => {
    const { executor, run } = createFixture(exited(0))
    const context = createContext()
    if (context.node.type !== 'command') throw new Error('Expected a command fixture node')

    const result = await executor.execute({
      ...context,
      node: { ...context.node, commandId: 'different-command' },
    })

    expect(result).toEqual({
      status: 'failed',
      code: 'COMMAND_CONTEXT_INVALID',
      message: 'Registered command does not match the workflow node',
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('routes an explicitly mapped non-zero exit without claiming process success', async () => {
    const { executor } = createFixture(exited(2))

    await expect(executor.execute(createContext())).resolves.toMatchObject({
      status: 'succeeded',
      outcome: 'blocked',
      output: { exitCode: 2 },
    })
  })

  it('fails when an exit code has no registered outcome', async () => {
    const { executor } = createFixture(exited(7))

    await expect(executor.execute(createContext())).resolves.toEqual({
      status: 'failed',
      code: 'COMMAND_EXIT_UNMAPPED',
      message: 'Command exited without a registered outcome',
    })
  })

  it.each([
    {
      processResult: {
        ...exited(0),
        status: 'timed-out' as const,
        signal: 'SIGKILL' as const,
      },
      expected: {
        status: 'failed',
        code: 'COMMAND_TIMEOUT',
        message: 'Command exceeded its configured timeout',
      },
    },
    {
      processResult: {
        ...exited(0),
        status: 'termination-unconfirmed' as const,
        reason: 'cancelled' as const,
        signal: 'SIGKILL' as const,
      },
      expected: {
        status: 'failed',
        code: 'COMMAND_TERMINATION_UNCONFIRMED',
        message: 'Command process-group termination could not be confirmed',
      },
    },
    {
      processResult: {
        ...exited(0),
        status: 'failed-to-start' as const,
        code: 'ENOENT',
        message: 'Process could not be started',
      },
      expected: {
        status: 'failed',
        code: 'COMMAND_START_FAILED',
        message: 'Registered command could not be started',
      },
    },
  ])(
    'maps $processResult.status to a stable executor failure',
    async ({ processResult, expected }) => {
      const { executor } = createFixture(processResult)

      await expect(executor.execute(createContext())).resolves.toEqual(expected)
    },
  )

  it('returns cancelled only after the runner confirms process-group termination', async () => {
    const { executor } = createFixture({
      ...exited(0),
      status: 'cancelled',
      signal: 'SIGKILL',
    })

    await expect(executor.execute(createContext())).resolves.toEqual({
      status: 'cancelled',
      reason: 'Command execution was cancelled',
    })
  })
})
