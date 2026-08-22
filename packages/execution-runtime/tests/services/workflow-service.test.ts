import { describe, expect, it, vi } from 'vitest'

import { createPredefinedV1Workflow } from '@slopify/workflow-model'

import {
  WorkflowServiceError,
  createWorkflowService,
  type WorkflowRepository,
} from '../../src/index.js'

const workflow = createPredefinedV1Workflow({
  createdAt: '2026-08-20T00:00:00.000Z',
  agentDefaults: { provider: 'openrouter', model: 'openai/gpt-5.4', thinkingLevel: 'medium' },
})

describe('workflow service', () => {
  it('lists and gets current workflows', () => {
    const workflows: WorkflowRepository = {
      save: vi.fn(),
      get: (workflowId) => (workflowId === workflow.workflowId ? workflow : undefined),
      list: () => [workflow],
    }
    const service = createWorkflowService({ workflows })

    expect(service.list()).toEqual([workflow])
    expect(service.get(workflow.workflowId)).toEqual(workflow)
  })

  it('reports an unknown workflow', () => {
    const workflows: WorkflowRepository = { save: vi.fn(), get: () => undefined, list: () => [] }
    const service = createWorkflowService({ workflows })

    expect(() => service.get('missing')).toThrow(
      expect.objectContaining({
        code: 'WORKFLOW_NOT_FOUND',
      }) satisfies Partial<WorkflowServiceError>,
    )
  })
})
