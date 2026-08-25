import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_WORKFLOW_TRANSITION_LIMIT,
  WorkflowSchema,
  createDefaultWorkflow,
} from '@slopify/workflow-model'

import {
  WorkflowServiceError,
  createWorkflowService,
  type HarnessCatalog,
  PersistenceError,
  type WorkflowRepository,
} from '../../src/index.js'

const workflow = WorkflowSchema.parse({
  ...createDefaultWorkflow({ createdAt: '2026-08-20T00:00:00.000Z' }),
  startNodeId: 'agent',
  nodes: [
    {
      type: 'agent',
      id: 'agent',
      name: 'Agent',
      prompt: 'Complete the workflow.',
      harness: { harnessId: 'pi', modelId: 'test-model', thinkingLevel: 'medium' },
    },
  ],
  maxTransitions: 0,
})

const availableHarnesses = (): HarnessCatalog => ({
  list: vi.fn(),
  get: vi.fn(),
  requireAvailable: vi.fn(async () => ({
    harnessId: 'pi',
    name: 'Pi',
    description: 'Run workflows with Pi.',
    availability: 'AVAILABLE',
    executablePath: '/usr/local/bin/pi',
    version: '0.84.2',
    installHref: 'https://pi.dev/',
    installLabel: 'Install Pi',
    models: [
      {
        id: 'test-model',
        name: 'test-model',
        thinkingLevels: ['medium'],
      },
    ],
  })),
})

describe('workflow service', () => {
  it('lists and gets current workflows', () => {
    const workflows: WorkflowRepository = {
      insert: vi.fn(),
      save: vi.fn(),
      get: (workflowId) => (workflowId === workflow.workflowId ? workflow : undefined),
      list: () => [workflow],
    }
    const service = createWorkflowService({ workflows, harnesses: availableHarnesses() })

    expect(service.list()).toEqual([workflow])
    expect(service.get(workflow.workflowId)).toEqual(workflow)
  })

  it('reports an unknown workflow', () => {
    const workflows: WorkflowRepository = {
      insert: vi.fn(),
      save: vi.fn(),
      get: () => undefined,
      list: () => [],
    }
    const service = createWorkflowService({ workflows, harnesses: availableHarnesses() })

    expect(() => service.get('missing')).toThrow(
      expect.objectContaining({
        code: 'WORKFLOW_NOT_FOUND',
      }) satisfies Partial<WorkflowServiceError>,
    )
  })

  it('creates and inserts a canonical empty workflow with server-owned fields', () => {
    const insert = vi.fn()
    const service = createWorkflowService({
      workflows: { insert, save: vi.fn(), get: () => undefined, list: () => [] },
      harnesses: availableHarnesses(),
      createId: () => 'workflow-release',
      now: () => '2026-08-24T14:00:00.000Z',
    })

    const created = service.create({
      name: 'Release workflow',
      description: 'Prepare and review a release.',
      configuration: { projectIds: [], primaryProjectId: null, variables: [] },
    })

    expect(created).toMatchObject({
      workflowId: 'workflow-release',
      name: 'Release workflow',
      startNodeId: null,
      nodes: [],
      edges: [],
      createdAt: '2026-08-24T14:00:00.000Z',
      updatedAt: '2026-08-24T14:00:00.000Z',
    })
    expect(insert).toHaveBeenCalledWith(created)
  })

  it('maps an insert collision to a stable workflow conflict', () => {
    const service = createWorkflowService({
      workflows: {
        insert: () => {
          throw new PersistenceError({
            code: 'PERSISTENCE_CONFLICT',
            message: 'Workflow already exists',
          })
        },
        save: vi.fn(),
        get: () => undefined,
        list: () => [],
      },
      harnesses: availableHarnesses(),
      createId: () => 'workflow-collision',
    })

    expect(() =>
      service.create({
        name: 'Release workflow',
        description: 'Prepare and review a release.',
        configuration: { projectIds: [], primaryProjectId: null, variables: [] },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'WORKFLOW_ID_CONFLICT',
      }) satisfies Partial<WorkflowServiceError>,
    )
  })

  it('updates a schema-valid draft and verifies every selected harness', async () => {
    const save = vi.fn()
    const harnesses = availableHarnesses()
    const service = createWorkflowService({
      workflows: {
        insert: vi.fn(),
        save,
        get: (workflowId) => (workflowId === workflow.workflowId ? workflow : undefined),
        list: () => [workflow],
      },
      harnesses,
      now: () => '2026-08-22T12:00:00.000Z',
    })
    const input = WorkflowSchema.parse({
      ...workflow,
      maxTransitions: 0,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      nodes: workflow.nodes.map((node) => ({
        ...node,
        prompt: 'Use the configured Pi harness.',
        harness: {
          harnessId: 'pi',
          modelId: 'test-model',
          thinkingLevel: 'medium',
        },
      })),
    })

    const updated = await service.update(workflow.workflowId, input)

    expect(updated).toMatchObject({
      workflowId: workflow.workflowId,
      createdAt: workflow.createdAt,
      updatedAt: '2026-08-22T12:00:00.000Z',
      maxTransitions: DEFAULT_WORKFLOW_TRANSITION_LIMIT,
    })
    expect(updated.nodes[0]).toMatchObject({
      prompt: 'Use the configured Pi harness.',
      harness: { harnessId: 'pi', modelId: 'test-model' },
    })
    expect(harnesses.requireAvailable).toHaveBeenCalledWith('pi', 'test-model', 'medium')
    expect(save).toHaveBeenCalledWith(updated)
  })

  it('rejects an agent when its selected harness is unavailable', async () => {
    const harnesses: HarnessCatalog = {
      ...availableHarnesses(),
      requireAvailable: vi.fn(async () => {
        throw new Error('missing')
      }),
    }
    const service = createWorkflowService({
      workflows: { insert: vi.fn(), save: vi.fn(), get: () => workflow, list: () => [workflow] },
      harnesses,
    })

    await expect(service.update(workflow.workflowId, workflow)).rejects.toMatchObject({
      code: 'WORKFLOW_HARNESS_UNAVAILABLE',
    })
  })

  it('persists branching agent workflows', async () => {
    const firstAgent = workflow.nodes[0]
    if (firstAgent === undefined) throw new Error('Expected an agent fixture')
    const save = vi.fn()
    const service = createWorkflowService({
      workflows: { insert: vi.fn(), save, get: () => workflow, list: () => [workflow] },
      harnesses: availableHarnesses(),
    })
    const secondAgent = { ...firstAgent, id: 'review-agent', name: 'Review agent' }
    const thirdAgent = { ...firstAgent, id: 'publish-agent', name: 'Publish agent' }
    const branch = {
      ...workflow,
      nodes: [firstAgent, secondAgent, thirdAgent],
      edges: [
        {
          sourceNodeId: firstAgent.id,
          targetNodeId: secondAgent.id,
          outcome: 'completed',
          label: 'Completed',
        },
        {
          sourceNodeId: firstAgent.id,
          targetNodeId: thirdAgent.id,
          outcome: 'completed',
          label: 'Completed',
        },
      ],
    }

    const updated = await service.update(workflow.workflowId, branch)

    expect(updated.edges).toHaveLength(2)
    expect(save).toHaveBeenCalledWith(updated)
  })
})
