import { describe, expect, it } from 'vitest'

import { WORKFLOW_DRAFT_TRANSITION_LIMIT, createWorkflowDraft } from '../../src/index.js'

describe('workflow draft', () => {
  it('creates a canonical empty draft with caller-provided identity and configuration', () => {
    const workflow = createWorkflowDraft({
      workflowId: 'release-workflow',
      description: 'Prepare and review a release.',
      configuration: {
        repositoryIds: ['repository-api'],
        primaryRepositoryId: 'repository-api',
        variables: ['release'],
      },
      createdAt: '2026-08-24T13:00:00.000Z',
    })

    expect(workflow).toEqual({
      schemaVersion: 3,
      workflowId: 'release-workflow',
      description: 'Prepare and review a release.',
      configuration: {
        repositoryIds: ['repository-api'],
        primaryRepositoryId: 'repository-api',
        variables: ['release'],
      },
      startNodeId: null,
      nodes: [],
      edges: [],
      maxTransitions: WORKFLOW_DRAFT_TRANSITION_LIMIT,
      createdAt: '2026-08-24T13:00:00.000Z',
      updatedAt: '2026-08-24T13:00:00.000Z',
    })
  })
})
