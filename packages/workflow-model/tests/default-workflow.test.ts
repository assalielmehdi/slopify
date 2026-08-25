import { describe, expect, it } from 'vitest'

import {
  DEFAULT_WORKFLOW_ID,
  DEFAULT_WORKFLOW_TRANSITION_LIMIT,
  createDefaultWorkflow,
  createWorkflowDraft,
  validateWorkflow,
} from '../src/index.js'

describe('default workflow', () => {
  it('creates a canonical empty draft with caller-provided identity and configuration', () => {
    const workflow = createWorkflowDraft({
      workflowId: 'release-workflow',
      name: 'Release workflow',
      description: 'Prepare and review a release.',
      configuration: {
        projectIds: ['project-api'],
        primaryProjectId: 'project-api',
        variables: ['release'],
      },
      createdAt: '2026-08-24T13:00:00.000Z',
    })

    expect(workflow).toEqual({
      schemaVersion: 1,
      workflowId: 'release-workflow',
      name: 'Release workflow',
      description: 'Prepare and review a release.',
      configuration: {
        projectIds: ['project-api'],
        primaryProjectId: 'project-api',
        variables: ['release'],
      },
      startNodeId: null,
      nodes: [],
      edges: [],
      maxTransitions: DEFAULT_WORKFLOW_TRANSITION_LIMIT,
      createdAt: '2026-08-24T13:00:00.000Z',
      updatedAt: '2026-08-24T13:00:00.000Z',
    })
  })

  it('creates one neutral empty draft', () => {
    const workflow = createDefaultWorkflow({ createdAt: '2026-08-23T00:00:00.000Z' })

    expect(workflow).toMatchObject({
      workflowId: DEFAULT_WORKFLOW_ID,
      name: 'Untitled workflow',
      description: 'Add agents and connect them to build a workflow.',
      configuration: { projectIds: [], primaryProjectId: null, variables: [] },
      startNodeId: null,
      nodes: [],
      edges: [],
      maxTransitions: DEFAULT_WORKFLOW_TRANSITION_LIMIT,
    })
    expect(validateWorkflow(workflow)).toMatchObject({ valid: true, findings: [] })
  })
})
