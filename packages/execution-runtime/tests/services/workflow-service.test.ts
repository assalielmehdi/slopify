import { describe, expect, it, vi } from 'vitest'

import {
  PREDEFINED_V1_TRANSITION_LIMIT,
  WorkflowSchema,
  createPredefinedV1Workflow,
} from '@slopify/workflow-model'

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

  it('updates a schema-valid draft and canonicalizes app-owned fields and live skills', async () => {
    const save = vi.fn()
    const captured = {
      snapshotId: `sha256:${'b'.repeat(64)}`,
      skillId: 'research',
      name: 'research',
      description: 'Research current sources.',
      digest: 'b'.repeat(64),
      path: '/snapshots/research',
    }
    const service = createWorkflowService({
      workflows: {
        save,
        get: (workflowId) => (workflowId === workflow.workflowId ? workflow : undefined),
        list: () => [workflow],
      },
      skills: {
        refresh: vi.fn(),
        get: vi.fn(async () => ({
          ...captured,
          modifiedAt: '2026-08-22T10:00:00.000Z',
          valid: true,
          issues: [],
          files: [],
        })),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      skillSnapshots: { capture: vi.fn(async () => captured), get: vi.fn() },
      now: () => '2026-08-22T12:00:00.000Z',
    })
    const input = WorkflowSchema.parse({
      ...workflow,
      maxTransitions: 0,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      nodes: [
        ...workflow.nodes,
        {
          type: 'agent',
          id: 'research-agent',
          name: 'Research agent',
          job: {
            kind: 'agent',
            prompt: 'Research {{ topic }}.',
            inference: {
              connectionId: 'chatgpt-default',
              modelId: 'gpt-5.5',
              thinkingLevel: 'high',
            },
            skillSnapshotRefs: [
              {
                skillId: 'research',
                snapshotId: `sha256:${'b'.repeat(64)}`,
                digest: 'b'.repeat(64),
                name: 'untrusted',
                description: 'untrusted',
              },
            ],
          },
        },
      ],
      edges: [
        {
          sourceNodeId: 'identify-agent',
          targetNodeId: 'research-agent',
          outcome: 'completed',
          label: 'Completed',
        },
      ],
    })

    const updated = await service.update(workflow.workflowId, input)

    expect(updated).toMatchObject({
      workflowId: workflow.workflowId,
      createdAt: workflow.createdAt,
      updatedAt: '2026-08-22T12:00:00.000Z',
      maxTransitions: PREDEFINED_V1_TRANSITION_LIMIT,
    })
    expect(updated.nodes.at(-1)).toMatchObject({
      description: 'Workflow agent',
      timeoutSeconds: 300,
      job: { skillSnapshotRefs: [{ name: 'research', description: 'Research current sources.' }] },
    })
    expect(save).toHaveBeenCalledWith(updated)
  })

  it('preserves an unchanged immutable skill ref without consulting the live catalog', async () => {
    const existingReference = {
      skillId: 'removed-skill',
      snapshotId: `sha256:${'a'.repeat(64)}`,
      digest: 'a'.repeat(64),
      name: 'removed-skill',
      description: 'Captured before the live skill was removed.',
    } as const
    const existing = WorkflowSchema.parse({
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.type === 'agent'
          ? { ...node, job: { ...node.job, skillSnapshotRefs: [existingReference] } }
          : node,
      ),
    })
    const getSkill = vi.fn()
    const service = createWorkflowService({
      workflows: { save: vi.fn(), get: () => existing, list: () => [existing] },
      skills: {
        refresh: vi.fn(),
        get: getSkill,
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      skillSnapshots: { capture: vi.fn(), get: vi.fn() },
      now: () => '2026-08-22T12:00:00.000Z',
    })

    const updated = await service.update(existing.workflowId, existing)

    expect(updated.nodes[0]?.type === 'agent' && updated.nodes[0].job.skillSnapshotRefs).toEqual([
      existingReference,
    ])
    expect(getSkill).not.toHaveBeenCalled()
  })

  it('captures the default skill for every connector attached to an agent', async () => {
    const captured = {
      snapshotId: `sha256:${'d'.repeat(64)}`,
      skillId: 'gitlab-connector',
      name: 'gitlab-connector',
      description: 'Use GitLab safely.',
      digest: 'd'.repeat(64),
      path: '/snapshots/gitlab-connector',
    }
    const save = vi.fn()
    const service = createWorkflowService({
      workflows: { save, get: () => workflow, list: () => [workflow] },
      skills: {
        refresh: vi.fn(),
        get: vi.fn(async () => ({
          ...captured,
          modifiedAt: '2026-08-22T10:00:00.000Z',
          valid: true,
          issues: [],
          files: [],
        })),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      skillSnapshots: { capture: vi.fn(async () => captured), get: vi.fn() },
      connectorSkillIds: () => ['gitlab-connector'],
    })
    const input = WorkflowSchema.parse({
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.type === 'agent'
          ? { ...node, job: { ...node.job, connectorIds: ['gitlab-default'] } }
          : node,
      ),
    })

    const updated = await service.update(workflow.workflowId, input)

    expect(updated.nodes[0]?.type === 'agent' && updated.nodes[0].job.skillSnapshotRefs).toEqual([
      expect.objectContaining({ skillId: 'gitlab-connector' }),
    ])
    expect(save).toHaveBeenCalledWith(updated)
  })

  it('reports a stable skill mismatch instead of trusting stale client metadata', async () => {
    const service = createWorkflowService({
      workflows: { save: vi.fn(), get: () => workflow, list: () => [workflow] },
      skills: {
        refresh: vi.fn(),
        get: vi.fn(async () => ({
          skillId: 'research',
          name: 'research',
          description: 'Research.',
          digest: 'c'.repeat(64),
          modifiedAt: '2026-08-22T10:00:00.000Z',
          valid: true,
          issues: [],
          files: [],
        })),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      skillSnapshots: { capture: vi.fn(), get: vi.fn() },
    })
    const input = WorkflowSchema.parse({
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.type === 'agent'
          ? {
              ...node,
              job: {
                ...node.job,
                skillSnapshotRefs: [
                  {
                    skillId: 'research',
                    snapshotId: `sha256:${'b'.repeat(64)}`,
                    digest: 'b'.repeat(64),
                    name: 'research',
                    description: 'Research.',
                  },
                ],
              },
            }
          : node,
      ),
    })

    await expect(service.update(workflow.workflowId, input)).rejects.toMatchObject({
      code: 'WORKFLOW_SKILL_MISMATCH',
    })
  })

  it('rejects branching and joining agent workflows', async () => {
    const firstAgent = workflow.nodes[0]
    if (firstAgent?.type !== 'agent') throw new Error('Expected an agent fixture')
    const service = createWorkflowService({
      workflows: { save: vi.fn(), get: () => workflow, list: () => [workflow] },
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
    const join = {
      ...branch,
      startNodeId: secondAgent.id,
      edges: [
        {
          sourceNodeId: secondAgent.id,
          targetNodeId: thirdAgent.id,
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

    await expect(service.update(workflow.workflowId, branch)).rejects.toMatchObject({
      code: 'WORKFLOW_NOT_LINEAR',
    })
    await expect(service.update(workflow.workflowId, join)).rejects.toMatchObject({
      code: 'WORKFLOW_NOT_LINEAR',
    })
  })
})
