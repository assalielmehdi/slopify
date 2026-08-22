import { describe, expect, it } from 'vitest'

import {
  PREDEFINED_V1_COMMAND_IDS,
  PREDEFINED_V1_TRANSITION_LIMIT,
  createPredefinedV1DraftWorkflow,
  createPredefinedV1Workflow,
  getReachableNodeIds,
  hasDirectedCycle,
  validateWorkflow,
} from '../src/index.js'

const workflow = createPredefinedV1Workflow({
  createdAt: '2026-08-20T20:00:00Z',
  agentDefaults: {
    provider: 'openrouter',
    model: 'openai/gpt-5.4',
    thinkingLevel: 'medium',
  },
})

describe('predefined V1 workflow', () => {
  it('creates the fresh user workflow as an empty draft with no provider reference', () => {
    expect(
      createPredefinedV1DraftWorkflow({ createdAt: '2026-08-22T00:00:00.000Z' }),
    ).toMatchObject({
      workflowId: 'delivery-workflow',
      name: 'Untitled workflow',
      startNodeId: null,
      nodes: [],
      edges: [],
    })
  })

  it('defines one minimal agent job that asks the agent who it is', () => {
    expect(PREDEFINED_V1_COMMAND_IDS).toEqual([])
    expect(workflow).toMatchObject({
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
      ],
      edges: [],
    })
  })

  it('is valid, acyclic, and fully reachable', () => {
    const result = validateWorkflow(workflow, {
      registeredCommandIds: new Set(PREDEFINED_V1_COMMAND_IDS),
    })

    expect(result.valid).toBe(true)
    expect(result.findings).toEqual([])
    expect(PREDEFINED_V1_TRANSITION_LIMIT).toBeGreaterThan(0)
    expect(hasDirectedCycle(workflow)).toBe(false)
    expect(getReachableNodeIds(workflow)).toEqual(['identify-agent'])
  })
})
