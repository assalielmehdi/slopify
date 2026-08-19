import { afterEach, describe, expect, it } from 'vitest'

import { createExecutorRegistry, createRunEngine, type NodeExecutor } from '../../src/index.js'
import { TEST_RUN_ID, createPersistenceFixture, createRun } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const succeeded = (outcome: string, output: unknown = { outcome }) => ({
  status: 'succeeded' as const,
  outcome,
  artifactIds: [],
  output,
})

const expectedTrace = (fixCycles: number): string[] => {
  const trace = [
    'load-clickup-task',
    'select-repositories',
    'prepare-worktrees',
    'plan',
    'implement',
    'verify',
    'requirements-review',
    'security-review',
    'simplification-review',
    'aggregate-review',
  ]
  for (let cycle = 0; cycle < fixCycles; cycle += 1) {
    trace.push(
      'fix-findings',
      'verify',
      'requirements-review',
      'security-review',
      'simplification-review',
      'aggregate-review',
    )
  }
  trace.push('finalize-delivery')
  return trace
}

const createReviewLoop = (fixCyclesBeforeClean: number, blockedFixPass?: number) => {
  const fixture = createPersistenceFixture()
  fixtures.push(fixture)
  createRun(fixture)
  let aggregatePass = 0
  let fixPass = 0
  let executionIndex = 0
  const command = (outcome: string): NodeExecutor => ({
    execute: async () => succeeded(outcome),
  })
  const review: NodeExecutor = { execute: async () => succeeded('reviewed') }
  const engine = createRunEngine({
    runs: fixture.runs,
    workflows: fixture.workflows,
    executors: createExecutorRegistry({
      commands: {
        'load-clickup-task': command('loaded'),
        'prepare-git-worktrees': command('ready'),
        'verify-selected-repositories': {
          execute: async () => succeeded('passed', { verificationPass: true }),
        },
        'aggregate-review-findings': {
          execute: async () => {
            aggregatePass += 1
            const status = aggregatePass <= fixCyclesBeforeClean ? 'changes-required' : 'clean'
            return succeeded(status, { reviewPass: aggregatePass, status })
          },
        },
        'finalize-gitlab-delivery': command('delivered'),
      },
      agents: {
        'select-repositories': command('selected'),
        plan: command('ready'),
        implement: command('implemented'),
        'requirements-review': review,
        'security-review': review,
        'simplification-review': review,
        'fix-findings': {
          execute: async () => {
            fixPass += 1
            if (fixPass === blockedFixPass) {
              return succeeded('blocked', { fixPass, reason: 'Finding is outside scope' })
            }
            return succeeded('fixed', { fixPass, commits: [`fix-commit-${fixPass}`] })
          },
        },
      },
    }),
    now: () => Date.parse('2026-08-19T13:00:00Z'),
    createNodeExecutionId: () => `node-execution-${++executionIndex}`,
  })
  return { engine, fixture }
}

describe('bounded predefined review loop', () => {
  it.each([0, 1, 2])(
    'runs every verification and fresh sequential review after %i fix cycles',
    async (fixCycles) => {
      const { engine, fixture } = createReviewLoop(fixCycles)

      const result = await engine.execute(TEST_RUN_ID)

      expect(result).toMatchObject({ status: 'completed', run: { status: 'SUCCEEDED' } })
      const executions = fixture.runs.listNodeExecutions(TEST_RUN_ID)
      expect(executions.map(({ nodeId }) => nodeId)).toEqual(expectedTrace(fixCycles))
      expect(new Set(executions.map(({ nodeExecutionId }) => nodeExecutionId)).size).toBe(
        executions.length,
      )
      expect(
        executions.filter(({ nodeId }) => nodeId === 'fix-findings').map(({ output }) => output),
      ).toEqual(
        Array.from({ length: fixCycles }, (_, index) => ({
          fixPass: index + 1,
          commits: [`fix-commit-${index + 1}`],
        })),
      )
      expect(
        executions
          .filter(({ nodeId }) => nodeId === 'aggregate-review')
          .map(({ output }) => output),
      ).toEqual([
        ...Array.from({ length: fixCycles }, (_, index) => ({
          reviewPass: index + 1,
          status: 'changes-required',
        })),
        { reviewPass: fixCycles + 1, status: 'clean' },
      ])
      expect(result.run.transitionCount).toBe(expectedTrace(fixCycles).length)
    },
  )

  it('routes an explicit blocked fix to the failed terminal with its evidence preserved', async () => {
    const { engine, fixture } = createReviewLoop(1, 1)

    const result = await engine.execute(TEST_RUN_ID)

    expect(result).toMatchObject({
      status: 'completed',
      run: { status: 'FAILED', currentNodeId: 'failed' },
    })
    expect(result).not.toHaveProperty('failure')
    expect(fixture.runs.listNodeExecutions(TEST_RUN_ID).at(-1)).toMatchObject({
      nodeId: 'fix-findings',
      status: 'SUCCEEDED',
      outcome: 'blocked',
      output: { fixPass: 1, reason: 'Finding is outside scope' },
    })
  })

  it('fails visibly at the approved limit without selecting another review edge', async () => {
    const { engine, fixture } = createReviewLoop(Number.POSITIVE_INFINITY)

    const result = await engine.execute(TEST_RUN_ID)

    expect(result).toMatchObject({
      status: 'failed',
      failure: {
        code: 'TRANSITION_LIMIT_EXCEEDED',
        nodeId: 'requirements-review',
      },
      run: { status: 'FAILED', transitionCount: 24 },
    })
    const executions = fixture.runs.listNodeExecutions(TEST_RUN_ID)
    expect(executions.at(-1)).toMatchObject({
      nodeId: 'requirements-review',
      status: 'FAILED',
      errorCode: 'TRANSITION_LIMIT_EXCEEDED',
    })
    expect(executions.filter(({ nodeId }) => nodeId === 'fix-findings')).toHaveLength(3)
    expect(executions.filter(({ nodeId }) => nodeId === 'verify')).toHaveLength(4)
    expect(
      executions.filter(({ nodeId }) => nodeId === 'aggregate-review').map(({ output }) => output),
    ).toEqual([
      { reviewPass: 1, status: 'changes-required' },
      { reviewPass: 2, status: 'changes-required' },
      { reviewPass: 3, status: 'changes-required' },
    ])
    expect(
      fixture.events
        .list({ runId: TEST_RUN_ID, limit: 100 })
        .events.filter(({ type }) => type === 'EDGE_SELECTED'),
    ).toHaveLength(24)
  })
})
