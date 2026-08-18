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
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    thinkingLevel: 'high',
  },
})

describe('derivePredefinedV1Revision', () => {
  it.each([
    ['provider', { provider: 'openai' }],
    ['model', { model: 'gpt-5.6' }],
    ['thinking level', { thinkingLevel: 'medium' }],
    ['prompt template', { promptTemplate: 'Produce a revised execution plan.' }],
    ['permission profile', { permissionProfile: 'workspace-write' }],
    ['resource bundle', { resourceBundleId: 'delivery-planning-v2' }],
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

      const parentPlan = parent.nodes.find((node) => node.id === 'plan')
      const derivedPlan = derived.nodes.find((node) => node.id === 'plan')
      expect(derivedPlan).not.toEqual(parentPlan)
    },
  )

  it('preserves the source-controlled topology', () => {
    const derived = derivePredefinedV1Revision(parent, {
      revisionId: 'revision-02',
      createdAt: '2026-08-18T21:00:00Z',
      updates: [{ nodeId: 'plan', changes: { model: 'gpt-5.6' } }],
    })

    expect(derived.startNodeId).toBe(parent.startNodeId)
    expect(derived.edges).toEqual(parent.edges)
    expect(derived.nodes.map(({ id, type }) => [id, type])).toEqual(
      parent.nodes.map(({ id, type }) => [id, type]),
    )
  })

  it('addresses a non-agent update at the update input path', () => {
    try {
      derivePredefinedV1Revision(parent, {
        revisionId: 'revision-02',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [{ nodeId: 'verify', changes: { model: 'gpt-5.6' } }],
      })
      expect.unreachable('Expected revision derivation to fail')
    } catch (error) {
      expect(error).toMatchObject({ code: 'NODE_NOT_AGENT', path: ['updates', 0, 'nodeId'] })
    }
  })

  it.each([
    [
      'REVISION_ID_REUSED',
      {
        revisionId: 'revision-01',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [{ nodeId: 'plan', changes: { model: 'gpt-5.6' } }],
      },
    ],
    [
      'NO_CONFIGURATION_CHANGE',
      {
        revisionId: 'revision-02',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [{ nodeId: 'plan', changes: { model: 'claude-sonnet-4-5' } }],
      },
    ],
    [
      'NODE_NOT_AGENT',
      {
        revisionId: 'revision-02',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [{ nodeId: 'verify', changes: { model: 'gpt-5.6' } }],
      },
    ],
    [
      'NODE_NOT_FOUND',
      {
        revisionId: 'revision-02',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [{ nodeId: 'missing', changes: { model: 'gpt-5.6' } }],
      },
    ],
    [
      'POLICY_INVARIANT_VIOLATION',
      {
        revisionId: 'revision-02',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [
          { nodeId: 'requirements-review', changes: { permissionProfile: 'workspace-write' } },
        ],
      },
    ],
    [
      'POLICY_INVARIANT_VIOLATION',
      {
        revisionId: 'revision-02',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [
          { nodeId: 'select-repositories', changes: { workspacePolicy: 'selected-worktrees' } },
        ],
      },
    ],
    [
      'INVALID_CONFIGURATION',
      {
        revisionId: 'revision-02',
        createdAt: '2026-08-18T21:00:00Z',
        updates: [{ nodeId: 'plan', changes: { model: 'gpt-5.6' } }],
        maxTransitions: 23,
      },
    ],
  ])('rejects invalid revision derivation with %s', (code, input) => {
    try {
      derivePredefinedV1Revision(parent, input)
      expect.unreachable('Expected revision derivation to fail')
    } catch (error) {
      expect(error).toMatchObject({ code })
    }
  })
})
