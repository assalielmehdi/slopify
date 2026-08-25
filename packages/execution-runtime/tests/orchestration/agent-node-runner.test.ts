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

const workspaceRoot = '/Users/operator/.slopify/orchestrator/workspaces/run-01'

const createAgentWorkflow = (prompt: string) =>
  WorkflowSchema.parse({
    schemaVersion: 2,
    workflowId: 'test-workflow',
    name: 'Agent workflow',
    description: 'Exercises an agent in configured repository clones.',
    configuration: {
      repositoryIds: ['repository-api', 'repository-web'],
      primaryRepositoryId: 'repository-api',
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

const provisionedRepositories = [
  {
    repositoryId: 'repository-api',
    position: 0,
    name: 'API',
    provider: 'GITHUB',
    remoteId: '101',
    fullName: 'operator/api',
    cloneUrl: 'https://github.com/operator/api.git',
    defaultBranch: 'main',
    workspacePath: `${workspaceRoot}/repository-api`,
    branchName: 'slopify/run-01',
    baseSha: 'a'.repeat(40),
    isPrimary: true,
  },
  {
    repositoryId: 'repository-web',
    position: 1,
    name: 'Web',
    provider: 'GITLAB',
    remoteId: '202',
    fullName: 'operator/web',
    cloneUrl: 'https://gitlab.com/operator/web.git',
    defaultBranch: 'trunk',
    workspacePath: `${workspaceRoot}/repository-web`,
    branchName: 'slopify/run-01',
    baseSha: 'b'.repeat(40),
    isPrimary: false,
  },
] as const

const createWorkspaces = (): RunWorkspaceProvisioner => ({
  ensure: vi.fn(async () => provisionedRepositories),
  cleanup: vi.fn(async () => undefined),
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
  it('runs the configured harness from the primary run clone and traces immutable context', async () => {
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
          primaryRepositoryId: 'repository-api',
          repositories: [
            { repositoryId: 'repository-api', path: `${workspaceRoot}/repository-api` },
            { repositoryId: 'repository-web', path: `${workspaceRoot}/repository-web` },
          ],
        },
        model: 'test-model',
        thinkingLevel: 'medium',
        declaredOutcomes: ['completed'],
        timeoutSeconds: 300,
      })
      expect(received?.renderedPrompt).toContain('Primary repository — API (GITHUB operator/api)')
      expect(received?.renderedPrompt).toContain(`Workspace: ${workspaceRoot}/repository-api`)
      expect(received?.renderedPrompt).toContain('Web (GITLAB operator/web)')
      expect(received?.renderedPrompt).toContain(`Workspace: ${workspaceRoot}/repository-web`)
      expect(received?.renderedPrompt).toContain('Branch: slopify/run-01')
      expect(received?.renderedPrompt).toContain(
        'Slopify will not push branches or create pull requests',
      )
      expect(traces.start).toHaveBeenCalledWith({
        version: 3,
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
          primaryRepositoryId: 'repository-api',
          repositories: [
            {
              repositoryId: 'repository-api',
              name: 'API',
              provider: 'GITHUB',
              fullName: 'operator/api',
              workspacePath: `${workspaceRoot}/repository-api`,
              branchName: 'slopify/run-01',
              baseSha: 'a'.repeat(40),
              defaultBranch: 'main',
            },
            {
              repositoryId: 'repository-web',
              name: 'Web',
              provider: 'GITLAB',
              fullName: 'operator/web',
              workspacePath: `${workspaceRoot}/repository-web`,
              branchName: 'slopify/run-01',
              baseSha: 'b'.repeat(40),
              defaultBranch: 'trunk',
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

  it('fails before starting the harness when a run workspace cannot be prepared', async () => {
    const fixture = createPersistenceFixture()
    try {
      const workflow = createAgentWorkflow('Inspect the repositories')
      fixture.workflows.save(workflow)
      createRun(fixture, workflow)
      const spawned = vi.fn()
      const agent = createSuccessfulAgent(spawned)
      const workspaces: RunWorkspaceProvisioner = {
        ensure: vi.fn(async () => {
          throw new RunWorkspaceProvisioningError([
            { repositoryId: 'repository-web', message: 'Git clone failed' },
          ])
        }),
        cleanup: vi.fn(async () => undefined),
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
        message: 'Git clone failed',
      })
      expect(spawned).not.toHaveBeenCalled()
    } finally {
      fixture.cleanup()
    }
  })

  it('fails deterministically when no executor implements the selected harness', async () => {
    const fixture = createPersistenceFixture()
    try {
      const workflow = createAgentWorkflow('Inspect the repositories')
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
