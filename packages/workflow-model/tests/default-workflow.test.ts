import { describe, expect, it } from 'vitest'

import {
  DEFAULT_WORKFLOW_ID,
  DEFAULT_WORKFLOW_TRANSITION_LIMIT,
  createDefaultWorkflow,
  validateWorkflow,
} from '../src/index.js'

describe('default workflow', () => {
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
