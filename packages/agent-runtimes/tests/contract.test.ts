import { describe, expect, it } from 'vitest'

import {
  AgentCancelResultSchema,
  AgentExecutionEventSchema,
  AgentExecutionInputSchema,
  AgentNodeResultSchema,
} from '../src/index.js'

const executionInput = {
  executionId: 'execution-01',
  runId: 'run-01',
  nodeId: 'plan',
  workspace: {
    rootPath: '/workspaces/run-01',
    repositories: [
      {
        repositoryId: 'backend',
        path: '/workspaces/run-01/backend',
        access: 'read-only',
      },
      {
        repositoryId: 'web',
        path: '/workspaces/run-01/web',
        access: 'read-only',
      },
    ],
  },
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  thinkingLevel: 'high',
  permissionProfile: 'read-only',
  renderedPrompt: '# Plan\n\nInspect only the explicit workspace map.',
  declaredOutcomes: ['planned', 'blocked'],
  resourceBundleId: 'delivery.planning.v1',
  timeoutSeconds: 600,
}

const result = {
  outcome: 'planned',
  summary: 'Prepared a bounded implementation plan.',
  data: { sections: 3 },
  artifacts: [
    {
      type: 'EXECUTION_PLAN',
      title: 'Execution plan',
      content: '# Plan\n\nThree ordered slices.',
    },
  ],
  evidence: [{ kind: 'file', value: 'tasks/plan.md' }],
}

const eventBase = {
  executionId: 'execution-01',
  runId: 'run-01',
  nodeId: 'plan',
  timestamp: '2026-08-19T00:00:00.000Z',
}

describe('agent execution input contract', () => {
  it('parses one explicit application-owned execution input', () => {
    const parsed = AgentExecutionInputSchema.parse(executionInput)

    expect(parsed).toEqual(executionInput)
  })

  it.each([
    ['execution ID', { ...executionInput, executionId: undefined }],
    ['run ID', { ...executionInput, runId: undefined }],
    ['node ID', { ...executionInput, nodeId: undefined }],
    ['provider', { ...executionInput, provider: '  ' }],
    ['model', { ...executionInput, model: '' }],
    ['thinking level', { ...executionInput, thinkingLevel: '' }],
    ['rendered prompt', { ...executionInput, renderedPrompt: '  ' }],
    ['declared outcomes', { ...executionInput, declaredOutcomes: [] }],
    ['resource bundle', { ...executionInput, resourceBundleId: '' }],
    ['timeout', { ...executionInput, timeoutSeconds: 0 }],
  ])('rejects a missing or malformed %s', (_field, input) => {
    expect(AgentExecutionInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejects duplicate repository IDs or paths', () => {
    const duplicateId = {
      ...executionInput,
      workspace: {
        ...executionInput.workspace,
        repositories: [
          executionInput.workspace.repositories[0],
          {
            repositoryId: 'backend',
            path: '/workspaces/run-01/other',
            access: 'read-only',
          },
        ],
      },
    }
    const duplicatePath = {
      ...executionInput,
      workspace: {
        ...executionInput.workspace,
        repositories: [
          executionInput.workspace.repositories[0],
          {
            repositoryId: 'other',
            path: '/workspaces/run-01/backend',
            access: 'read-only',
          },
        ],
      },
    }

    expect(AgentExecutionInputSchema.safeParse(duplicateId).success).toBe(false)
    expect(AgentExecutionInputSchema.safeParse(duplicatePath).success).toBe(false)
  })

  it('rejects repository paths outside the explicit workspace root', () => {
    const input = {
      ...executionInput,
      workspace: {
        ...executionInput.workspace,
        repositories: [
          {
            repositoryId: 'backend',
            path: '/other-run/backend',
            access: 'read-only',
          },
        ],
      },
    }

    expect(AgentExecutionInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejects repository access broader than the selected permission profile', () => {
    const input = {
      ...executionInput,
      workspace: {
        ...executionInput.workspace,
        repositories: [
          {
            repositoryId: 'backend',
            path: '/workspaces/run-01/backend',
            access: 'workspace-write',
          },
        ],
      },
    }

    expect(AgentExecutionInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejects duplicate outcomes and caller-selected tools or harnesses', () => {
    expect(
      AgentExecutionInputSchema.safeParse({
        ...executionInput,
        declaredOutcomes: ['planned', 'planned'],
      }).success,
    ).toBe(false)
    expect(
      AgentExecutionInputSchema.safeParse({
        ...executionInput,
        tools: ['bash'],
      }).success,
    ).toBe(false)
    expect(
      AgentExecutionInputSchema.safeParse({
        ...executionInput,
        harness: 'another-agent',
      }).success,
    ).toBe(false)
  })
})

describe('agent result contract', () => {
  it('parses a structured result without SDK-owned values', () => {
    expect(AgentNodeResultSchema.parse(result)).toEqual(result)
  })

  it.each([
    ['undeclared shape', { ...result, extra: true }],
    ['missing data', { ...result, data: undefined }],
    ['blank summary', { ...result, summary: '  ' }],
    ['unknown artifact type', { ...result, artifacts: [{ ...result.artifacts[0], type: 'LOG' }] }],
    ['unknown evidence kind', { ...result, evidence: [{ kind: 'thought', value: 'hidden' }] }],
  ])('rejects %s', (_description, input) => {
    expect(AgentNodeResultSchema.safeParse(input).success).toBe(false)
  })
})

describe('agent execution event contract', () => {
  it('parses every normalized event variant', () => {
    const events = [
      { ...eventBase, type: 'AGENT_STARTED', data: {} },
      {
        ...eventBase,
        type: 'AGENT_SESSION_IDENTIFIED',
        data: { sessionId: 'session-01' },
      },
      { ...eventBase, type: 'AGENT_MESSAGE', data: { content: 'Visible assistant text.' } },
      {
        ...eventBase,
        type: 'AGENT_TOOL_STARTED',
        data: { toolCallId: 'tool-call-01', toolName: 'read' },
      },
      {
        ...eventBase,
        type: 'AGENT_TOOL_UPDATED',
        data: { toolCallId: 'tool-call-01', content: 'Read 20 lines.' },
      },
      {
        ...eventBase,
        type: 'AGENT_TOOL_COMPLETED',
        data: {
          toolCallId: 'tool-call-01',
          toolName: 'read',
          status: 'succeeded',
          content: 'Read 20 lines.',
        },
      },
      {
        ...eventBase,
        type: 'AGENT_RESULT',
        data: {
          result,
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 25,
            cacheWriteTokens: 0,
          },
          durationMs: 1_000,
        },
      },
      {
        ...eventBase,
        type: 'AGENT_FAILED',
        data: { code: 'PROVIDER_FAILED', message: 'Provider request failed', durationMs: 500 },
      },
      {
        ...eventBase,
        type: 'AGENT_CANCELLED',
        data: { reason: 'Run cancellation requested', durationMs: 250 },
      },
    ]

    expect(events.map((event) => AgentExecutionEventSchema.parse(event).type)).toEqual(
      events.map(({ type }) => type),
    )
  })

  it('rejects unknown event types and extra raw SDK fields', () => {
    expect(
      AgentExecutionEventSchema.safeParse({ ...eventBase, type: 'TURN_STARTED', data: {} }).success,
    ).toBe(false)
    expect(
      AgentExecutionEventSchema.safeParse({
        ...eventBase,
        type: 'AGENT_MESSAGE',
        data: { content: 'Visible text', thinking: 'hidden chain of thought' },
      }).success,
    ).toBe(false)
  })
})

describe('agent cancellation contract', () => {
  it.each(['cancelled', 'unconfirmed'] as const)('accepts the %s result', (status) => {
    expect(AgentCancelResultSchema.parse({ status })).toEqual({ status })
  })

  it('rejects an invented cancellation result', () => {
    expect(AgentCancelResultSchema.safeParse({ status: 'probably-cancelled' }).success).toBe(false)
  })
})
