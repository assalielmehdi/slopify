import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  AgentNodeSchema,
  CreateWorkflowInputSchema,
  WorkflowEdgeSchema,
  WorkflowSchema,
  WorkflowSlugSchema,
  type CreateWorkflowInput,
  type Workflow,
} from '../src/index.js'

const agentNode = {
  type: 'agent',
  id: 'plan',
  name: 'Plan',
  prompt: 'Create an execution plan for {{ objective }}.',
  harness: {
    harnessId: 'pi',
    modelId: 'test/model',
    thinkingLevel: 'high',
  },
  timeoutSeconds: 900,
} as const

const workflow = {
  schemaVersion: 3,
  workflowId: 'workflow-01',
  description: 'Coordinate local agents.',
  configuration: {
    repositoryIds: ['repository-api', 'repository-web'],
    primaryRepositoryId: 'repository-api',
    variables: ['objective', 'release context'],
  },
  startNodeId: 'plan',
  nodes: [agentNode],
  edges: [],
  maxTransitions: 24,
  createdAt: '2026-08-18T20:00:00Z',
  updatedAt: '2026-08-18T21:00:00Z',
} as const

describe('workflow node contracts', () => {
  it('defaults each editable agent timeout to fifteen minutes', () => {
    expect(
      AgentNodeSchema.parse({
        type: 'agent',
        id: 'new-agent',
        name: 'New agent',
        prompt: 'Use {{ task }}.',
        harness: { harnessId: 'pi' },
      }),
    ).toEqual({
      type: 'agent',
      id: 'new-agent',
      name: 'New agent',
      prompt: 'Use {{ task }}.',
      harness: { harnessId: 'pi' },
      timeoutSeconds: 900,
    })
  })

  it('allows only agent nodes and current harness configuration', () => {
    expect(AgentNodeSchema.parse(agentNode)).toEqual(agentNode)

    for (const removedNode of [
      { type: 'unknown', id: 'unknown', name: 'Unknown' },
      { ...agentNode, unexpected: true },
    ]) {
      expect(AgentNodeSchema.safeParse(removedNode).success).toBe(false)
    }
  })

  it.each([59, 61, 28_860, 900.5])('rejects invalid agent timeout %j', (timeoutSeconds) => {
    expect(AgentNodeSchema.safeParse({ ...agentNode, timeoutSeconds }).success).toBe(false)
  })
})

describe('workflow document contract', () => {
  it('accepts only editable fields when creating a workflow', () => {
    const input = {
      workflowId: 'release-workflow',
      description: 'Prepare and review a release.',
      configuration: {
        repositoryIds: ['repository-api'],
        primaryRepositoryId: 'repository-api',
        variables: ['release'],
      },
    } as const

    expect(CreateWorkflowInputSchema.parse(input)).toEqual(input)
    expectTypeOf(CreateWorkflowInputSchema.parse(input)).toEqualTypeOf<CreateWorkflowInput>()
    expect(CreateWorkflowInputSchema.safeParse({ ...input, unexpected: true }).success).toBe(false)
    expect(
      CreateWorkflowInputSchema.safeParse({ ...input, workflowId: 'release workflow' }).success,
    ).toBe(false)
    expect(CreateWorkflowInputSchema.safeParse({ ...input, description: undefined }).success).toBe(
      false,
    )
  })

  it('accepts only canonical workflow IDs', () => {
    expect(WorkflowSlugSchema.parse('release-2026')).toBe('release-2026')

    for (const workflowId of [
      'Release-workflow',
      'release workflow',
      '-release',
      'release-',
      'release--workflow',
      'release_workflow',
      'a'.repeat(65),
    ]) {
      expect(WorkflowSlugSchema.safeParse(workflowId).success).toBe(false)
    }
  })

  it('parses the complete workflow document', () => {
    expect(WorkflowSchema.parse(workflow)).toEqual(workflow)
  })

  it('requires the version and workflow configuration', () => {
    expect(WorkflowSchema.safeParse({ ...workflow, schemaVersion: undefined }).success).toBe(false)
    expect(WorkflowSchema.safeParse({ ...workflow, configuration: undefined }).success).toBe(false)
  })

  it('rejects unknown workflow fields', () => {
    expect(WorkflowSchema.safeParse({ ...workflow, unexpected: true }).success).toBe(false)
  })

  it('rejects unknown agent configuration instead of transforming it', () => {
    expect(
      WorkflowSchema.safeParse({
        ...workflow,
        nodes: [
          {
            ...agentNode,
            unexpected: true,
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('requires unique repositories and variables plus a selected primary repository', () => {
    expect(
      WorkflowSchema.safeParse({
        ...workflow,
        configuration: {
          ...workflow.configuration,
          repositoryIds: ['repository-api', 'repository-api'],
        },
      }).success,
    ).toBe(false)
    expect(
      WorkflowSchema.safeParse({
        ...workflow,
        configuration: { ...workflow.configuration, primaryRepositoryId: null },
      }).success,
    ).toBe(false)
    expect(
      WorkflowSchema.safeParse({
        ...workflow,
        configuration: { ...workflow.configuration, variables: ['objective', 'objective'] },
      }).success,
    ).toBe(false)
  })

  it('freezes parsed graph records', () => {
    const parsed = WorkflowSchema.parse(workflow)

    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.nodes)).toBe(true)
    expect(Object.isFrozen(parsed.nodes[0])).toBe(true)
    expect(Object.isFrozen(parsed.nodes[0]?.harness)).toBe(true)
    expect(Object.isFrozen(parsed.edges)).toBe(true)
  })

  it.each([-1, 1.5, Number.POSITIVE_INFINITY])(
    'rejects invalid transition bound %j',
    (maxTransitions) => {
      expect(WorkflowSchema.safeParse({ ...workflow, maxTransitions }).success).toBe(false)
    },
  )

  it('rejects malformed graph identifiers, timestamps, and extra public fields', () => {
    expect(WorkflowSchema.safeParse({ ...workflow, startNodeId: 'Plan Node' }).success).toBe(false)
    expect(
      WorkflowEdgeSchema.safeParse({
        sourceNodeId: 'plan',
        outcome: 'READY_NOW',
        targetNodeId: 'review',
        label: 'Ready',
      }).success,
    ).toBe(false)
    expect(WorkflowSchema.safeParse({ ...workflow, createdAt: 'yesterday' }).success).toBe(false)
    expect(WorkflowSchema.safeParse({ ...workflow, apiToken: 'secret' }).success).toBe(false)
  })

  it('preserves the inferred current workflow type', () => {
    expectTypeOf(WorkflowSchema.parse(workflow)).toEqualTypeOf<Workflow>()
  })
})
