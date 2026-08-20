import { describe, expect, it, vi } from 'vitest'

import {
  AgentExecutionEventSchema,
  type AgentExecutionInput,
  type AgentExecutor,
} from '@loop/agent-runtimes'
import { createPredefinedV1Revision } from '@loop/workflow-model'
import { z } from 'zod'

import { createAgentJobRunner, createAgentResultSchemaRegistry } from '../../src/index.js'
import { TEST_RUN_ID, createPersistenceFixture, createRun } from '../persistence/test-fixture.js'

describe('agent job runner', () => {
  it('builds one execution from the immutable job definition and every run worktree', async () => {
    const fixture = createPersistenceFixture()
    try {
      createRun(fixture, fixture.revision)
      fixture.runs.selectRepositories({
        runId: TEST_RUN_ID,
        selectedAt: '2026-08-20T12:00:00.000Z',
        selection: {
          selected: [
            { repositoryId: 'api', rationale: 'API changes', responsibility: 'Backend' },
            { repositoryId: 'web', rationale: 'UI changes', responsibility: 'Frontend' },
          ],
          excluded: [{ repositoryId: 'docs', rationale: 'No docs work' }],
        },
      })
      for (const repositoryId of ['api', 'web'] as const) {
        fixture.runs.recordWorkspace({
          runId: TEST_RUN_ID,
          repositoryId,
          repositoryPath: `/sources/${repositoryId}`,
          worktreePath: `/runs/run-01/${repositoryId}`,
          remote: 'origin',
          targetBranch: 'main',
          sourceBranch: `work/${repositoryId}`,
          baseSha: 'a'.repeat(40),
          createdAt: '2026-08-20T12:00:00.000Z',
        })
      }
      let received: AgentExecutionInput | undefined
      const agent: AgentExecutor = {
        execute(input) {
          received = input
          return (async function* () {
            yield AgentExecutionEventSchema.parse({
              executionId: input.executionId,
              runId: input.runId,
              nodeId: input.nodeId,
              timestamp: '2026-08-20T12:00:01.000Z',
              type: 'AGENT_STARTED',
              data: {},
            })
            yield AgentExecutionEventSchema.parse({
              executionId: input.executionId,
              runId: input.runId,
              nodeId: input.nodeId,
              timestamp: '2026-08-20T12:00:02.000Z',
              type: 'AGENT_RESULT',
              data: {
                result: {
                  outcome: 'ready',
                  summary: 'Plan complete',
                  data: { plan: ['api', 'web'] },
                  artifacts: [],
                  evidence: [{ kind: 'note', value: 'Inspected both worktrees' }],
                },
                usage: {
                  inputTokens: 10,
                  outputTokens: 20,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                },
                durationMs: 1_000,
              },
            })
          })()
        },
        cancel: vi.fn(async () => ({ status: 'cancelled' })),
      }
      const progress = vi.fn(async () => undefined)
      const runner = createAgentJobRunner({
        agent,
        runs: fixture.runs,
        resultSchemas: createAgentResultSchemaRegistry({
          'workflow-output/execution-plan-v1': z.object({ plan: z.array(z.string()) }),
        }),
        resolveInference: (connectionId) =>
          connectionId === 'test-provider-default' ? { provider: 'test-provider' } : undefined,
      })

      await expect(
        runner.run(
          {
            runId: TEST_RUN_ID,
            nodeExecutionId: 'node-execution-plan',
            attemptId: 'attempt-plan',
            nodeId: 'plan',
          },
          progress,
        ),
      ).resolves.toMatchObject({
        status: 'succeeded',
        outcome: 'ready',
        output: {
          summary: 'Plan complete',
          data: { plan: ['api', 'web'] },
          evidence: [{ kind: 'note', value: 'Inspected both worktrees' }],
          usage: { inputTokens: 10, outputTokens: 20 },
        },
      })
      expect(received).toMatchObject({
        executionId: 'node-execution-plan',
        runId: TEST_RUN_ID,
        nodeId: 'plan',
        provider: 'test-provider',
        model: 'test-model',
        thinkingLevel: 'medium',
        permissionProfile: 'workspace-write',
        workspace: {
          rootPath: '/runs/run-01',
          repositories: [
            { repositoryId: 'api', path: '/runs/run-01/api', access: 'workspace-write' },
            { repositoryId: 'web', path: '/runs/run-01/web', access: 'workspace-write' },
          ],
        },
      })
      expect(received?.renderedPrompt).toContain('Plan the approved task')
      expect(received?.renderedPrompt).toContain('Implement persistence')
      expect(progress).toHaveBeenCalledWith({ eventType: 'AGENT_STARTED', data: {} })
    } finally {
      fixture.cleanup()
    }
  })

  it('fails before spawning when inference access is unavailable', async () => {
    const fixture = createPersistenceFixture()
    try {
      createRun(fixture, fixture.revision)
      const agent: AgentExecutor = {
        execute: vi.fn(),
        cancel: vi.fn(async () => ({ status: 'cancelled' })),
      }
      const runner = createAgentJobRunner({
        agent,
        runs: fixture.runs,
        resultSchemas: createAgentResultSchemaRegistry({
          'workflow-output/execution-plan-v1': z.json(),
        }),
        resolveInference: () => undefined,
      })

      await expect(
        runner.run(
          {
            runId: TEST_RUN_ID,
            nodeExecutionId: 'node-execution-plan',
            attemptId: 'attempt-plan',
            nodeId: 'plan',
          },
          async () => undefined,
        ),
      ).resolves.toMatchObject({ status: 'failed', code: 'INFERENCE_CONNECTION_UNAVAILABLE' })
      expect(agent.execute).not.toHaveBeenCalled()
    } finally {
      fixture.cleanup()
    }
  })

  it('runs a repository-free agent in an empty private workspace', async () => {
    const fixture = createPersistenceFixture()
    try {
      const revision = createPredefinedV1Revision({
        revisionId: 'revision-basic-agent',
        createdAt: '2026-08-20T12:00:00.000Z',
        agentDefaults: {
          provider: 'test-provider',
          model: 'test-model',
          thinkingLevel: 'medium',
        },
      })
      fixture.workflows.addRevision(revision)
      createRun(fixture, revision)
      let received: AgentExecutionInput | undefined
      const agent: AgentExecutor = {
        execute(input) {
          received = input
          return (async function* () {
            yield AgentExecutionEventSchema.parse({
              executionId: input.executionId,
              runId: input.runId,
              nodeId: input.nodeId,
              timestamp: '2026-08-20T12:00:02.000Z',
              type: 'AGENT_RESULT',
              data: {
                result: {
                  outcome: 'completed',
                  summary: 'Identity explained',
                  data: { identity: 'A test agent' },
                  artifacts: [],
                  evidence: [],
                },
                usage: {
                  inputTokens: 10,
                  outputTokens: 20,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                },
                durationMs: 1_000,
              },
            })
          })()
        },
        cancel: vi.fn(async () => ({ status: 'cancelled' })),
      }
      const runner = createAgentJobRunner({
        agent,
        runs: fixture.runs,
        resultSchemas: createAgentResultSchemaRegistry({ 'json:any-v1': z.json() }),
        resolveInference: () => ({ provider: 'test-provider' }),
      })

      await expect(
        runner.run(
          {
            runId: TEST_RUN_ID,
            nodeExecutionId: 'node-execution-identify-agent',
            attemptId: 'attempt-identify-agent',
            nodeId: 'identify-agent',
          },
          async () => undefined,
        ),
      ).resolves.toMatchObject({ status: 'succeeded', outcome: 'completed' })
      expect(received?.workspace).toEqual({ rootPath: '/', repositories: [] })
      expect(received?.renderedPrompt).toContain(
        'You must finish by calling complete_node exactly once.',
      )
      expect(received?.renderedPrompt).toContain('Declared outcomes: completed')
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects result data that does not satisfy the declared schema', async () => {
    const fixture = createPersistenceFixture()
    try {
      createRun(fixture, fixture.revision)
      fixture.runs.selectRepositories({
        runId: TEST_RUN_ID,
        selectedAt: '2026-08-20T12:00:00.000Z',
        selection: {
          selected: [{ repositoryId: 'api', rationale: 'API changes', responsibility: 'Backend' }],
          excluded: [
            { repositoryId: 'web', rationale: 'No UI changes' },
            { repositoryId: 'docs', rationale: 'No docs changes' },
          ],
        },
      })
      fixture.runs.recordWorkspace({
        runId: TEST_RUN_ID,
        repositoryId: 'api',
        repositoryPath: '/sources/api',
        worktreePath: '/runs/run-01/api',
        remote: 'origin',
        targetBranch: 'main',
        sourceBranch: 'work/api',
        baseSha: 'a'.repeat(40),
        createdAt: '2026-08-20T12:00:00.000Z',
      })
      const agent: AgentExecutor = {
        execute(input) {
          return (async function* () {
            yield AgentExecutionEventSchema.parse({
              executionId: input.executionId,
              runId: input.runId,
              nodeId: input.nodeId,
              timestamp: '2026-08-20T12:00:02.000Z',
              type: 'AGENT_RESULT',
              data: {
                result: {
                  outcome: 'ready',
                  summary: 'Invalid plan',
                  data: { plan: 'not-an-array' },
                  artifacts: [],
                  evidence: [],
                },
                usage: {
                  inputTokens: 10,
                  outputTokens: 20,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                },
                durationMs: 1_000,
              },
            })
          })()
        },
        cancel: vi.fn(async () => ({ status: 'cancelled' })),
      }
      const runner = createAgentJobRunner({
        agent,
        runs: fixture.runs,
        resultSchemas: createAgentResultSchemaRegistry({
          'workflow-output/execution-plan-v1': z.object({ plan: z.array(z.string()) }),
        }),
        resolveInference: () => ({ provider: 'test-provider' }),
      })

      await expect(
        runner.run(
          {
            runId: TEST_RUN_ID,
            nodeExecutionId: 'node-execution-plan',
            attemptId: 'attempt-plan',
            nodeId: 'plan',
          },
          async () => undefined,
        ),
      ).resolves.toMatchObject({ status: 'failed', code: 'AGENT_RESULT_SCHEMA_INVALID' })
    } finally {
      fixture.cleanup()
    }
  })
})
