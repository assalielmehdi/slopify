import { describe, expect, it } from 'vitest'

import { convertWorkflowV1, validateWorkflow } from '../src/index.js'

const legacyWorkflow = {
  schemaVersion: 1,
  workflowId: 'release-review',
  name: 'Release review',
  description: 'Review and approve a release.',
  configuration: {
    projectIds: ['repository-api'],
    primaryProjectId: 'repository-api',
    variables: ['release'],
  },
  startNodeId: 'review',
  nodes: [
    {
      type: 'agent',
      id: 'review',
      name: 'Review',
      prompt: 'Review {{ release }}.',
      harness: { harnessId: 'pi', modelId: 'anthropic/claude-sonnet-4', thinkingLevel: 'high' },
    },
    {
      type: 'agent',
      id: 'approve',
      name: 'Approve',
      prompt: 'Approve the reviewed release.',
      harness: { harnessId: 'pi' },
    },
  ],
  edges: [
    {
      sourceNodeId: 'review',
      outcome: 'approved',
      targetNodeId: 'approve',
      label: 'Approved',
    },
  ],
  maxTransitions: 1,
  createdAt: '2026-08-20T12:00:00.000Z',
  updatedAt: '2026-08-21T12:00:00.000Z',
} as const

describe('workflow v1 converter', () => {
  it('preserves graph behavior while renaming project selection to repositories', () => {
    const converted = convertWorkflowV1(legacyWorkflow)

    expect(converted).toEqual({
      ...legacyWorkflow,
      schemaVersion: 2,
      configuration: {
        repositoryIds: ['repository-api'],
        primaryRepositoryId: 'repository-api',
        variables: ['release'],
      },
    })
    expect(validateWorkflow(converted)).toMatchObject({ valid: true, findings: [] })
  })

  it('rejects malformed legacy graphs instead of repairing them', () => {
    expect(() =>
      convertWorkflowV1({
        ...legacyWorkflow,
        edges: [{ ...legacyWorkflow.edges[0], targetNodeId: 'missing' }],
      }),
    ).toThrow()
  })
})
