import { describe, expect, it, vi } from 'vitest'

import {
  AgentExecutionEventSchema,
  type AgentExecutionInput,
  type AgentExecutor,
} from '@slopify/contracts'
import { WorkflowSchema } from '@slopify/workflow-model'

import {
  RunWorkspaceProvisioningError,
  createAgentNodeRunner,
  type RunWorkspaceProvisioner,
} from '../../src/index.js'
import { TEST_RUN_ID, createRun, createPersistenceFixture } from '../persistence/test-fixture.js'

const workspaceRoot = '/Users/operator/.slopify/orchestrator/worktrees/run-01'

const createAgentWorkflow = (prompt: string) =>
  WorkflowSchema.parse({
    schemaVersion: 1,
    workflowId: 'test-workflow',
    name: 'Agent workflow',
    description: 'Exercises an agent in configured project worktrees.',
    configuration: {
      projectIds: ['project-api', 'project-web'],
      primaryProjectId: 'project-api',
      variables: prompt.includes('{{ task }}') ? ['task'] : [],
    },
    startNodeId: 'identify-agent',
    nodes: [
      {
        type: 'agent',
        id: 'identify-agent',
        name: 'Identify agent',
        prompt,
        harness: { harnessId: 'pi', modelId: 'test-model', thinkingLevel: 'medium' },
      },
    ],
    edges: [],
    maxTransitions: 0,
    createdAt: '2026-08-23T12:00:00.000Z',
    updatedAt: '2026-08-23T12:00:00.000Z',
  })

const provisionedProjects = [
  {
    projectId: 'project-api',
    position: 0,
    name: 'API',
    repositoryPath: '/Users/operator/source/api',
    worktreePath: `${workspaceRoot}/project-api`,
    baseSha: 'a'.repeat(40),
    sourceBranch: 'main',
    isPrimary: true,
  },
  {
    projectId: 'project-web',
    position: 1,
    name: 'Web',
    repositoryPath: '/Users/operator/source/web',
    worktreePath: `${workspaceRoot}/project-web`,
    baseSha: 'b'.repeat(40),
    sourceBranch: null,
    isPrimary: false,
  },
] as const

const createWorkspaces = (): RunWorkspaceProvisioner => ({
  ensure: vi.fn(async () => provisionedProjects),
})

const createAvailableHarnesses = () => ({
  requireAvailable: vi.fn(async () => ({
    harnessId: 'pi' as const,
    name: 'Pi',
    description: 'Run workflows with the Pi CLI configured on this machine.',
    availability: 'AVAILABLE' as const,
    executablePath: '/usr/local/bin/pi',
    version: '0.84.2',
    installHref: 'https://pi.dev/',
    installLabel: 'Install Pi',
    models: [],
  })),
})

const createSuccessfulAgent = (
  receive: (input: AgentExecutionInput) => void,
  data: unknown = { plan: ['api', 'web'] },
): AgentExecutor => ({
  execute(input) {
    receive(input)
    return (async function* () {
      yield AgentExecutionEventSchema.parse({
        executionId: input.executionId,
        runId: input.runId,
        nodeId: input.nodeId,
        timestamp: '2026-08-23T12:00:01.000Z',
        type: 'AGENT_STARTED',
        data: {},
      })
      yield AgentExecutionEventSchema.parse({
        executionId: input.executionId,
        runId: input.runId,
        nodeId: input.nodeId,
        timestamp: '2026-08-23T12:00:02.000Z',
        type: 'AGENT_RESULT',
        data: {
          result: {
            outcome: 'completed',
            summary: 'Plan complete',
            data,
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
})

describe('agent node runner', () => {
  it('runs the configured harness from the primary run worktree and traces immutable context', async () => {
    const fixture = createPersistenceFixture()
    try {
      const workflow = createAgentWorkflow('Plan {{ task }} and leave {{ typo }} literal')
      fixture.workflows.save(workflow)
      createRun(fixture, workflow, { task: 'the refactor' })
      let received: AgentExecutionInput | undefined
      const agent = createSuccessfulAgent((input) => {
        received = input
      })
      const workspaces = createWorkspaces()
      const traces = {
        start: vi.fn(async () => undefined),
        append: vi.fn(async () => undefined),
        read: vi.fn(),
      }
      const runner = createAgentNodeRunner({
        harnesses: createAvailableHarnesses(),
        resolveHarness: (harnessId) => (harnessId === 'pi' ? agent : undefined),
        workspaces,
        runs: fixture.runs,
        traces,
        now: () => '2026-08-23T12:00:00.000Z',
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
      ).resolves.toMatchObject({
        status: 'succeeded',
        outcome: 'completed',
        output: {
          summary: 'Plan complete',
          data: { plan: ['api', 'web'] },
          usage: { inputTokens: 10, outputTokens: 20 },
        },
      })
      expect(workspaces.ensure).toHaveBeenCalledWith(TEST_RUN_ID)
      expect(received).toMatchObject({
        executionId: 'node-execution-plan',
        runId: TEST_RUN_ID,
        nodeId: 'identify-agent',
        workspace: {
          rootPath: workspaceRoot,
          primaryProjectId: 'project-api',
          projects: [
            { projectId: 'project-api', path: `${workspaceRoot}/project-api` },
            { projectId: 'project-web', path: `${workspaceRoot}/project-web` },
          ],
        },
        model: 'test-model',
        thinkingLevel: 'medium',
        declaredOutcomes: ['completed'],
        timeoutSeconds: 300,
      })
      expect(received?.renderedPrompt).toContain(
        `Primary project — API: ${workspaceRoot}/project-api`,
      )
      expect(received?.renderedPrompt).toContain(`Web: ${workspaceRoot}/project-web`)
      expect(received?.renderedPrompt).not.toContain('/Users/operator/source')
      expect(traces.start).toHaveBeenCalledWith({
        version: 1,
        runId: TEST_RUN_ID,
        nodeExecutionId: 'node-execution-plan',
        attemptId: 'attempt-plan',
        nodeId: 'identify-agent',
        createdAt: '2026-08-23T12:00:00.000Z',
        configuration: {
          harnessId: 'pi',
          harnessVersion: '0.84.2',
          model: 'test-model',
          thinkingLevel: 'medium',
          renderedPrompt: expect.any(String),
          workspaceRoot,
          primaryProjectId: 'project-api',
          projects: [
            {
              projectId: 'project-api',
              name: 'API',
              worktreePath: `${workspaceRoot}/project-api`,
              baseSha: 'a'.repeat(40),
              sourceBranch: 'main',
            },
            {
              projectId: 'project-web',
              name: 'Web',
              worktreePath: `${workspaceRoot}/project-web`,
              baseSha: 'b'.repeat(40),
              sourceBranch: null,
            },
          ],
          timeoutSeconds: 300,
        },
      })
      expect(traces.append).toHaveBeenCalledTimes(2)
    } finally {
      fixture.cleanup()
    }
  })

  it('fails before starting the harness when a run worktree cannot be prepared', async () => {
    const fixture = createPersistenceFixture()
    try {
      const workflow = createAgentWorkflow('Inspect the projects')
      fixture.workflows.save(workflow)
      createRun(fixture, workflow)
      const spawned = vi.fn()
      const agent = createSuccessfulAgent(spawned)
      const workspaces: RunWorkspaceProvisioner = {
        ensure: vi.fn(async () => {
          throw new RunWorkspaceProvisioningError([
            { projectId: 'project-web', message: 'Git worktree creation failed' },
          ])
        }),
      }
      const runner = createAgentNodeRunner({
        harnesses: createAvailableHarnesses(),
        resolveHarness: () => agent,
        workspaces,
        runs: fixture.runs,
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
      ).resolves.toEqual({
        status: 'failed',
        code: 'RUN_WORKSPACE_PROVISIONING_FAILED',
        message: 'Git worktree creation failed',
      })
      expect(spawned).not.toHaveBeenCalled()
    } finally {
      fixture.cleanup()
    }
  })

  it('fails deterministically when no executor implements the selected harness', async () => {
    const fixture = createPersistenceFixture()
    try {
      const workflow = createAgentWorkflow('Inspect the projects')
      fixture.workflows.save(workflow)
      createRun(fixture, workflow)
      const runner = createAgentNodeRunner({
        harnesses: createAvailableHarnesses(),
        resolveHarness: () => undefined,
        workspaces: createWorkspaces(),
        runs: fixture.runs,
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
      ).resolves.toMatchObject({ status: 'failed', code: 'HARNESS_EXECUTOR_UNAVAILABLE' })
    } finally {
      fixture.cleanup()
    }
  })
})
