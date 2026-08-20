import { describe, expect, it } from 'vitest'

import {
  createPredefinedV1Revision,
  derivePredefinedV1Revision,
  type AgentNodeConfigurationChanges,
} from '../src/index.js'

const parent = createPredefinedV1Revision({
  revisionId: 'revision-01',
  createdAt: '2026-08-18T20:00:00Z',
  agentDefaults: {
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4.5',
    thinkingLevel: 'high',
  },
})

describe('derivePredefinedV1Revision', () => {
  it.each([
    ['inference connection', { connectionId: 'openrouter-secondary' }],
    ['model', { modelId: 'openai/gpt-5.4' }],
    ['thinking level', { thinkingLevel: 'medium' }],
    ['prompt', { prompt: 'Produce a revised execution plan.' }],
    ['connectors', { connectorIds: ['gitlab-primary'] }],
    ['output schema', { outputSchemaRef: 'workflow-output/execution-plan-v2' }],
    ['timeout', { timeoutSeconds: 1_500 }],
  ] satisfies readonly (readonly [string, AgentNodeConfigurationChanges])[])(
    'creates a distinct frozen revision after changing the %s',
    (_field, changes) => {
      const parentBefore = JSON.stringify(parent)
      const derived = derivePredefinedV1Revision(parent, {
        revisionId: 'revision-02',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [{ nodeId: 'plan', changes }],
      })

      expect(derived).not.toBe(parent)
      expect(derived.revisionId).toBe('revision-02')
      expect(derived.parentRevisionId).toBe(parent.revisionId)
      expect(Object.isFrozen(derived)).toBe(true)
      expect(JSON.stringify(parent)).toBe(parentBefore)
      expect(derived.nodes.find(({ id }) => id === 'plan')).not.toEqual(
        parent.nodes.find(({ id }) => id === 'plan'),
      )
    },
  )

  it('preserves the source-controlled topology', () => {
    const derived = derivePredefinedV1Revision(parent, {
      revisionId: 'revision-02',
      createdAt: '2026-08-18T21:00:00Z',
      updates: [{ nodeId: 'plan', changes: { modelId: 'openai/gpt-5.4' } }],
    })
    expect(derived.startNodeId).toBe(parent.startNodeId)
    expect(derived.edges).toEqual(parent.edges)
    expect(derived.nodes.map(({ id, type }) => [id, type])).toEqual(
      parent.nodes.map(({ id, type }) => [id, type]),
    )
  })

  it.each([
    [
      'REVISION_ID_REUSED',
      {
        revisionId: 'revision-01',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [{ nodeId: 'plan', changes: { modelId: 'openai/gpt-5.4' } }],
      },
    ],
    [
      'NO_CONFIGURATION_CHANGE',
      {
        revisionId: 'revision-02',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [{ nodeId: 'plan', changes: { modelId: 'anthropic/claude-sonnet-4.5' } }],
      },
    ],
    [
      'NODE_NOT_AGENT',
      {
        revisionId: 'revision-02',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [{ nodeId: 'verify', changes: { modelId: 'openai/gpt-5.4' } }],
      },
    ],
    [
      'NODE_NOT_FOUND',
      {
        revisionId: 'revision-02',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [{ nodeId: 'missing', changes: { modelId: 'openai/gpt-5.4' } }],
      },
    ],
    [
      'INVALID_CONFIGURATION',
      {
        revisionId: 'revision-02',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [{ nodeId: 'plan', changes: { modelId: 'openai/gpt-5.4' } }],
        maxTransitions: 23,
      },
    ],
  ])('rejects invalid revision derivation with %s', (code, input) => {
    expect(() => derivePredefinedV1Revision(parent, input)).toThrow(
      expect.objectContaining({ code }),
    )
  })
})
