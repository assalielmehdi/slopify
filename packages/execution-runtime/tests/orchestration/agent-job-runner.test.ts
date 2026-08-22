import { describe, expect, it, vi } from 'vitest'

import {
  AgentExecutionEventSchema,
  type AgentExecutionInput,
  type AgentExecutor,
} from '@slopify/agent-runtimes'
import { createPredefinedV1Workflow, WorkflowSchema } from '@slopify/workflow-model'
import { z } from 'zod'

import { createAgentJobRunner, createAgentResultSchemaRegistry } from '../../src/index.js'
import { TEST_RUN_ID, createPersistenceFixture, createRun } from '../persistence/test-fixture.js'

const createAgentWorkflow = (prompt: string, schemaRef = 'json:any-v1') => {
  const workflow = createPredefinedV1Workflow({
    createdAt: '2026-08-20T12:00:00.000Z',
    agentDefaults: {
      provider: 'test-provider',
      model: 'test-model',
      thinkingLevel: 'medium',
    },
  })
  return WorkflowSchema.parse({
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.type === 'agent'
        ? {
            ...node,
            result: { schemaRef },
            job: { ...node.job, prompt },
          }
        : node,
    ),
  })
}

describe('agent job runner', () => {
  it('builds one execution from the immutable job definition and run variables', async () => {
    const fixture = createPersistenceFixture()
    try {
      const workflow = createAgentWorkflow('Plan {{ task }}', 'workflow-output/execution-plan-v1')
      fixture.workflows.save(workflow)
      createRun(fixture, workflow)
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
                  outcome: 'completed',
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
      const traces = {
        start: vi.fn(async () => undefined),
        append: vi.fn(async () => undefined),
        read: vi.fn(),
      }
      const runner = createAgentJobRunner({
        agent,
        runs: fixture.runs,
        traces,
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
            nodeId: 'identify-agent',
          },
          progress,
        ),
      ).resolves.toMatchObject({
        status: 'succeeded',
        outcome: 'completed',
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
        nodeId: 'identify-agent',
        provider: 'test-provider',
        model: 'test-model',
        thinkingLevel: 'medium',
        permissionProfile: 'workspace-write',
        workspace: {
          rootPath: '/',
          repositories: [],
        },
      })
      expect(received?.renderedPrompt).toContain('Plan Implement persistence')
      expect(received?.renderedPrompt).not.toContain('{{ task }}')
      expect(progress).not.toHaveBeenCalled()
      expect(traces.start).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: TEST_RUN_ID,
          nodeExecutionId: 'node-execution-plan',
          attemptId: 'attempt-plan',
          configuration: expect.objectContaining({
            connectionId: 'test-provider-default',
            provider: 'test-provider',
            model: 'test-model',
          }),
        }),
      )
      expect(traces.append).toHaveBeenCalledTimes(2)
      expect(traces.append.mock.calls.map(([, event]) => event.type)).toEqual([
        'AGENT_STARTED',
        'AGENT_RESULT',
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('fails before spawning when inference access is unavailable', async () => {
    const fixture = createPersistenceFixture()
    try {
      const workflow = createAgentWorkflow('Identify yourself')
      fixture.workflows.save(workflow)
      createRun(fixture, workflow)
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
            nodeId: 'identify-agent',
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
      const workflow = createPredefinedV1Workflow({
        createdAt: '2026-08-20T12:00:00.000Z',
        agentDefaults: {
          provider: 'test-provider',
          model: 'test-model',
          thinkingLevel: 'medium',
        },
      })
      fixture.workflows.save(workflow)
      createRun(fixture, workflow)
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
      const workflow = createAgentWorkflow('Plan {{ task }}', 'workflow-output/execution-plan-v1')
      fixture.workflows.save(workflow)
      createRun(fixture, workflow)
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
                  outcome: 'completed',
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
            nodeId: 'identify-agent',
          },
          async () => undefined,
        ),
      ).resolves.toMatchObject({ status: 'failed', code: 'AGENT_RESULT_SCHEMA_INVALID' })
    } finally {
      fixture.cleanup()
    }
  })
})
