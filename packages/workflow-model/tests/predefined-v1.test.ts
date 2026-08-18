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
  revisionId: 'revision-01',
  createdAt: '2026-08-18T20:00:00Z',
  agentDefaults: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    thinkingLevel: 'high',
  },
})

describe('predefined V1 workflow', () => {
  it('validates with the complete registered command set', () => {
    const result = validateWorkflow(revision, {
      registeredCommandIds: new Set(PREDEFINED_V1_COMMAND_IDS),
    })

    expect(result.valid).toBe(true)
    expect(result.findings).toEqual([])
  })

  it('encodes every approved node variant and responsibility', () => {
    expect(revision.nodes.map(({ id, type }) => [id, type])).toEqual([
      ['load-clickup-task', 'command'],
      ['select-repositories', 'agent'],
      ['prepare-worktrees', 'command'],
      ['plan', 'agent'],
      ['implement', 'agent'],
      ['verify', 'command'],
      ['requirements-review', 'agent'],
      ['security-review', 'agent'],
      ['simplification-review', 'agent'],
      ['aggregate-review', 'command'],
      ['fix-findings', 'agent'],
      ['finalize-delivery', 'command'],
      ['failed', 'terminal'],
      ['succeeded', 'terminal'],
    ])

    expect(
      revision.nodes
        .filter((node) => node.type === 'command')
        .map(({ id, commandId }) => [id, commandId]),
    ).toEqual([
      ['load-clickup-task', 'load-clickup-task'],
      ['prepare-worktrees', 'prepare-git-worktrees'],
      ['verify', 'verify-selected-repositories'],
      ['aggregate-review', 'aggregate-review-findings'],
      ['finalize-delivery', 'finalize-gitlab-delivery'],
    ])
  })

  it('enforces the approved agent workspace and permission policies', () => {
    expect(
      revision.nodes
        .filter((node) => node.type === 'agent')
        .map(({ id, workspacePolicy, permissionProfile }) => [
          id,
          workspacePolicy,
          permissionProfile,
        ]),
    ).toEqual([
      ['select-repositories', 'candidate-repositories', 'read-only'],
      ['plan', 'selected-worktrees', 'read-only'],
      ['implement', 'selected-worktrees', 'workspace-write'],
      ['requirements-review', 'selected-worktrees', 'read-only'],
      ['security-review', 'selected-worktrees', 'read-only'],
      ['simplification-review', 'selected-worktrees', 'read-only'],
      ['fix-findings', 'selected-worktrees', 'workspace-write'],
    ])

    expect(
      revision.nodes
        .filter((node) => node.type === 'agent')
        .every(
          (node) =>
            node.provider === 'anthropic' &&
            node.model === 'claude-sonnet-4-5' &&
            node.thinkingLevel === 'high' &&
            !('harness' in node),
        ),
    ).toBe(true)
  })

  it('matches every approved outcome-to-edge transition', () => {
    expect(
      revision.edges.map(({ sourceNodeId, outcome, targetNodeId }) => [
        sourceNodeId,
        outcome,
        targetNodeId,
      ]),
    ).toEqual([
      ['load-clickup-task', 'loaded', 'select-repositories'],
      ['select-repositories', 'selected', 'prepare-worktrees'],
      ['select-repositories', 'blocked', 'failed'],
      ['prepare-worktrees', 'ready', 'plan'],
      ['plan', 'ready', 'implement'],
      ['plan', 'blocked', 'failed'],
      ['implement', 'implemented', 'verify'],
      ['implement', 'blocked', 'failed'],
      ['verify', 'passed', 'requirements-review'],
      ['verify', 'failed-checks', 'fix-findings'],
      ['requirements-review', 'reviewed', 'security-review'],
      ['requirements-review', 'blocked', 'failed'],
      ['security-review', 'reviewed', 'simplification-review'],
      ['security-review', 'blocked', 'failed'],
      ['simplification-review', 'reviewed', 'aggregate-review'],
      ['simplification-review', 'blocked', 'failed'],
      ['aggregate-review', 'changes-required', 'fix-findings'],
      ['aggregate-review', 'clean', 'finalize-delivery'],
      ['fix-findings', 'fixed', 'verify'],
      ['fix-findings', 'blocked', 'failed'],
      ['finalize-delivery', 'delivered', 'succeeded'],
    ])
  })

  it('keeps the approved cycle visible and bounded at 24 transitions', () => {
    expect(revision.maxTransitions).toBe(PREDEFINED_V1_TRANSITION_LIMIT)
    expect(PREDEFINED_V1_TRANSITION_LIMIT).toBe(24)
    expect(hasDirectedCycle(revision)).toBe(true)
    expect(getReachableNodeIds(revision)).toEqual(revision.nodes.map((node) => node.id))
  })

  it('allows two review-fix cycles before a clean delivery in 23 transitions', () => {
    const outcomes = [
      'loaded',
      'selected',
      'ready',
      'ready',
      'implemented',
      'passed',
      'reviewed',
      'reviewed',
      'reviewed',
      'changes-required',
      'fixed',
      'passed',
      'reviewed',
      'reviewed',
      'reviewed',
      'changes-required',
      'fixed',
      'passed',
      'reviewed',
      'reviewed',
      'reviewed',
      'clean',
      'delivered',
    ]
    let nodeId = revision.startNodeId

    for (const outcome of outcomes) {
      const edge = revision.edges.find(
        (candidate) => candidate.sourceNodeId === nodeId && candidate.outcome === outcome,
      )
      expect(edge).toBeDefined()
      nodeId = edge?.targetNodeId ?? nodeId
    }

    expect(outcomes).toHaveLength(23)
    expect(outcomes.length).toBeLessThanOrEqual(revision.maxTransitions)
    expect(nodeId).toBe('succeeded')
  })
})
