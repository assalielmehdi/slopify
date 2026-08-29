import { describe, expect, it } from 'vitest'

import { AgentNodeSchema, WorkflowSchema, getDeclaredOutcomes } from '../../src/index.js'

const agent = (id: string) => ({
  type: 'agent' as const,
  id,
  name: id,
  prompt: 'Review the selected repository clones and complete the node.',
  harness: {
    harnessId: 'pi' as const,
    modelId: 'test/model',
    thinkingLevel: 'high' as const,
  },
})

describe('agent node architecture', () => {
  it('requires an explicit harness selection', () => {
    expect(
      AgentNodeSchema.safeParse({
        type: 'agent',
        id: 'agent-01',
        name: 'Agent',
        prompt: 'Do the work.',
      }).success,
    ).toBe(false)
  })

  it('persists one flat harness-backed agent shape', () => {
    const workflow = WorkflowSchema.parse({
      schemaVersion: 3,
      workflowId: 'workflow-01',
      description: 'A workflow.',
      configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
      startNodeId: 'agent-01',
      nodes: [agent('agent-01'), agent('agent-02')],
      edges: [
        {
          sourceNodeId: 'agent-01',
          outcome: 'completed',
          targetNodeId: 'agent-02',
          label: 'Completed',
        },
      ],
      maxTransitions: 4,
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    })

    expect(workflow.nodes[0]).toMatchObject({ type: 'agent', harness: { harnessId: 'pi' } })
    expect(getDeclaredOutcomes(workflow, 'agent-01')).toEqual(['completed'])
  })

  it('rejects unknown agent configuration', () => {
    const current = agent('agent-01')

    expect(AgentNodeSchema.safeParse({ ...current, unexpected: true }).success).toBe(false)
  })
})
