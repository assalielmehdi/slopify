import { describe, expect, it } from 'vitest'

import { AgentJobDefinitionSchema, WorkflowSchema, getDeclaredOutcomes } from '../src/index.js'

const agentJob = {
  kind: 'agent',
  prompt: 'Review the selected worktrees and complete the node.',
  skillSnapshotRefs: [
    {
      skillId: 'gitlab-delivery',
      snapshotId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      name: 'gitlab-delivery',
      description: 'Deliver changes through GitLab.',
    },
  ],
  inference: {
    connectionId: 'openrouter-primary',
    modelId: 'anthropic/claude-sonnet-4.5',
    thinkingLevel: 'high',
  },
  connectorIds: ['gitlab-primary'],
} as const

describe('workflow job architecture', () => {
  it('requires only a prompt before publication defaults are resolved', () => {
    expect(AgentJobDefinitionSchema.parse({ kind: 'agent', prompt: 'Do the work.' })).toEqual({
      kind: 'agent',
      prompt: 'Do the work.',
      skillSnapshotRefs: [],
      inference: {
        connectionId: 'openrouter-default',
        modelId: 'openai/gpt-5.4',
        thinkingLevel: 'medium',
      },
      connectorIds: [],
    })
  })

  it('persists job, result, and sandbox concerns without flattened agent fields', () => {
    const workflow = WorkflowSchema.parse({
      workflowId: 'workflow-1',
      name: 'Workflow',
      description: 'A workflow.',
      startNodeId: 'agent-1',
      nodes: [
        {
          type: 'agent',
          id: 'agent-1',
          name: 'Agent',
          description: 'Run an agent.',
          timeoutSeconds: 600,
          result: { schemaRef: 'json:any-v1' },
          sandbox: {
            profileId: 'agent-default-v1',
            imageId: 'gondolin-alpine-v1',
          },
          job: agentJob,
        },
        { type: 'terminal', id: 'done', name: 'Done', terminalStatus: 'SUCCEEDED' },
      ],
      edges: [
        {
          sourceNodeId: 'agent-1',
          outcome: 'completed',
          targetNodeId: 'done',
          label: 'Completed',
        },
      ],
      maxTransitions: 4,
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    })

    expect(workflow.nodes[0]).toMatchObject({ type: 'agent', job: agentJob })
    expect(workflow.nodes[0]).not.toHaveProperty('provider')
    expect(workflow.nodes[0]).not.toHaveProperty('promptTemplate')
    expect(workflow.nodes[0]).not.toHaveProperty('outcomes')
    expect(getDeclaredOutcomes(workflow, 'agent-1')).toEqual(['completed'])
  })

  it('rejects unknown job kinds and duplicate grants', () => {
    expect(() => AgentJobDefinitionSchema.parse({ kind: 'code', prompt: 'No.' })).toThrow()
    expect(() =>
      AgentJobDefinitionSchema.parse({
        ...agentJob,
        connectorIds: ['gitlab-primary', 'gitlab-primary'],
      }),
    ).toThrow()
  })
})
