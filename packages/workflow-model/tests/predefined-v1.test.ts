import { describe, expect, it } from 'vitest'

import {
  PREDEFINED_V1_COMMAND_IDS,
  PREDEFINED_V1_TRANSITION_LIMIT,
  createPredefinedV1Revision,
  getReachableNodeIds,
  hasDirectedCycle,
  validateWorkflow,
} from '../src/index.js'

const revision = createPredefinedV1Revision({
  revisionId: 'revision-02',
  createdAt: '2026-08-20T20:00:00Z',
  agentDefaults: {
    provider: 'openrouter',
    model: 'openai/gpt-5.4',
    thinkingLevel: 'medium',
  },
})

describe('predefined V1 workflow', () => {
  it('defines one minimal agent job that asks the agent who it is', () => {
    expect(PREDEFINED_V1_COMMAND_IDS).toEqual([])
    expect(revision).toMatchObject({
      name: 'Who are you?',
      description: 'Run one agent and ask it to identify itself.',
      startNodeId: 'identify-agent',
      maxTransitions: PREDEFINED_V1_TRANSITION_LIMIT,
      nodes: [
        {
          type: 'agent',
          id: 'identify-agent',
          name: 'Who are you?',
          description: 'Ask the agent to identify itself.',
          timeoutSeconds: 300,
          result: { schemaRef: 'json:any-v1' },
          sandbox: { profileId: 'agent-default-v1', imageId: 'gondolin-alpine-v1' },
          job: {
            kind: 'agent',
            prompt: "Who are you? What's your name?",
            skillSnapshotRefs: [],
            inference: {
              connectionId: 'openrouter-default',
              modelId: 'openai/gpt-5.4',
              thinkingLevel: 'medium',
            },
            connectorIds: [],
          },
        },
        { type: 'terminal', id: 'succeeded', name: 'Succeeded', terminalStatus: 'SUCCEEDED' },
      ],
      edges: [
        {
          sourceNodeId: 'identify-agent',
          outcome: 'completed',
          targetNodeId: 'succeeded',
          label: 'Answered',
        },
      ],
    })
  })

  it('is valid, acyclic, and fully reachable', () => {
    const result = validateWorkflow(revision, {
      registeredCommandIds: new Set(PREDEFINED_V1_COMMAND_IDS),
    })

    expect(result.valid).toBe(true)
    expect(result.findings).toEqual([])
    expect(PREDEFINED_V1_TRANSITION_LIMIT).toBe(2)
    expect(hasDirectedCycle(revision)).toBe(false)
    expect(getReachableNodeIds(revision)).toEqual(['identify-agent', 'succeeded'])
  })
})
