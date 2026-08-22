import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  AgentExecutionInputSchema,
  createGondolinPiSdkAgentExecutor,
  type AgentSandboxFactory,
  type PiSessionFactory,
} from '../src/index.js'

const input = AgentExecutionInputSchema.parse({
  executionId: 'execution-01',
  runId: 'run-01',
  nodeId: 'plan',
  workspace: {
    rootPath: '/workspaces/run-01',
    repositories: [
      { repositoryId: 'api', path: '/workspaces/run-01/api', access: 'workspace-write' },
    ],
  },
  provider: 'openrouter',
  model: 'openai/gpt-5.4',
  thinkingLevel: 'medium',
  permissionProfile: 'workspace-write',
  renderedPrompt: 'Complete the task.',
  declaredOutcomes: ['completed'],
  resourceBundleId: 'delivery-planning-v1',
  timeoutSeconds: 60,
})

describe('Gondolin Pi executor', () => {
  it('creates and destroys one private sandbox around one fresh session', async () => {
    const close = vi.fn(async () => undefined)
    const sandboxFactory: AgentSandboxFactory = {
      create: vi.fn(async () => ({
        sandboxId: 'sandbox-01',
        workspaceRoot: '/workspace',
        tools: [],
        skills: [],
        close,
      })),
    }
    const sessionFactory: PiSessionFactory = {
      create: vi.fn(async () => ({
        sessionId: 'session-01',
        prompt: vi.fn(async () => undefined),
        subscribe: vi.fn(() => vi.fn()),
        abort: vi.fn(async () => undefined),
        waitForIdle: vi.fn(async () => undefined),
        isIdle: vi.fn(() => true),
        finish: vi.fn(() => ({
          outcome: 'completed',
          summary: 'Done',
          data: {},
          artifacts: [],
          evidence: [],
        })),
        getUsage: vi.fn(() => ({
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        })),
        dispose: vi.fn(),
      })),
    }
    const executor = createGondolinPiSdkAgentExecutor({
      sessionFactory,
      sandboxFactory,
      sensitiveValues: ['secret'],
      resolveContext: async () => ({
        outputSchema: z.object({}),
        resourceBundle: {
          bundleId: 'delivery-planning-v1',
          applicationVersion: '1',
          skills: [],
          promptFragments: [],
          contextFiles: [],
        },
        skills: [],
        connectors: [],
      }),
    })

    const events = []
    for await (const event of executor.execute(input)) events.push(event)

    expect(events.map(({ type }) => type)).toEqual([
      'AGENT_STARTED',
      'AGENT_SESSION_IDENTIFIED',
      'AGENT_RESULT',
    ])
    expect(sandboxFactory.create).toHaveBeenCalledWith({
      executionId: 'execution-01',
      worktrees: [{ repositoryId: 'api', hostPath: '/workspaces/run-01/api' }],
      skills: [],
      connectors: [],
    })
    expect(sessionFactory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: expect.objectContaining({ workspaceRoot: '/workspace' }),
      }),
    )
    expect(close).toHaveBeenCalledOnce()
  })
})
