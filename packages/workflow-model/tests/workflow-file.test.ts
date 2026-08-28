import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  WorkflowFileSchema,
  workflowFileToWorkflow,
  workflowToWorkflowFile,
  validateWorkflow,
  type Workflow,
  type WorkflowFile,
} from '../src/index.js'

const currentWorkflow = {
  schemaVersion: 3,
  workflowId: 'release-review',
  description: 'Prepare and review a release.',
  configuration: {
    repositoryIds: ['repository-api', 'repository-web'],
    primaryRepositoryId: 'repository-api',
    variables: ['release', 'risk context'],
  },
  startNodeId: 'prepare',
  nodes: [
    {
      type: 'agent',
      id: 'prepare',
      name: 'Prepare',
      prompt: 'Prepare {{ release }} with {{ risk context }}.',
      harness: { harnessId: 'pi' },
      timeoutSeconds: 900,
    },
  ],
  edges: [],
  maxTransitions: 24,
  createdAt: '2026-08-18T20:00:00Z',
  updatedAt: '2026-08-18T21:00:00Z',
} as const satisfies Workflow

const workflowFile = {
  schemaVersion: 3,
  workflowId: 'release-review',
  description: 'Prepare and review a release.',
  repositories: {
    repositoryIds: ['repository-api', 'repository-web'],
    primaryRepositoryId: 'repository-api',
  },
  variables: ['release', 'risk context'],
  graph: {
    startNodeId: 'prepare',
    nodes: currentWorkflow.nodes,
    edges: [],
    maxTransitions: 24,
  },
  createdAt: '2026-08-18T20:00:00Z',
  updatedAt: '2026-08-18T21:00:00Z',
} as const

describe('workflow file contract', () => {
  it('parses a strict, nested v3 workflow document with one canonical identity', () => {
    const parsed = WorkflowFileSchema.parse(workflowFile)

    expect(parsed).toEqual(workflowFile)
    expectTypeOf(parsed).toEqualTypeOf<WorkflowFile>()
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.repositories)).toBe(true)
    expect(Object.isFrozen(parsed.variables)).toBe(true)
    expect(Object.isFrozen(parsed.graph)).toBe(true)
  })

  it('rejects documents from unsupported schema versions', () => {
    expect(
      WorkflowFileSchema.safeParse({
        ...workflowFile,
        schemaVersion: 99,
      }).success,
    ).toBe(false)
  })

  it('requires canonical workflow IDs', () => {
    expect(
      WorkflowFileSchema.safeParse({ ...workflowFile, workflowId: 'a'.repeat(64) }).success,
    ).toBe(true)

    for (const workflowId of [
      '',
      'Release-review',
      'release_review',
      'release.review',
      '-release',
      'release-',
      'release--review',
      'a'.repeat(65),
    ]) {
      expect(WorkflowFileSchema.safeParse({ ...workflowFile, workflowId }).success).toBe(false)
    }
  })

  it('rejects unknown fields and invalid repository or variable selections', () => {
    expect(WorkflowFileSchema.safeParse({ ...workflowFile, name: 'Release review' }).success).toBe(
      false,
    )
    expect(WorkflowFileSchema.safeParse({ ...workflowFile, unexpected: true }).success).toBe(false)
    expect(
      WorkflowFileSchema.safeParse({
        ...workflowFile,
        repositories: { ...workflowFile.repositories, unexpected: true },
      }).success,
    ).toBe(false)
    expect(
      WorkflowFileSchema.safeParse({
        ...workflowFile,
        repositories: {
          repositoryIds: ['repository-api', 'repository-api'],
          primaryRepositoryId: 'repository-api',
        },
      }).success,
    ).toBe(false)
    expect(
      WorkflowFileSchema.safeParse({
        ...workflowFile,
        variables: ['release', 'release'],
      }).success,
    ).toBe(false)
  })

  it('converts current workflow records without changing their meaning', () => {
    expect(workflowToWorkflowFile(currentWorkflow)).toEqual(workflowFile)
    expect(workflowFileToWorkflow(workflowFile)).toEqual(currentWorkflow)
    expect(workflowFileToWorkflow(workflowToWorkflowFile(currentWorkflow))).toEqual(currentWorkflow)
  })

  it('accepts empty drafts independently of host harness readiness', () => {
    const draft = WorkflowFileSchema.parse({
      ...workflowFile,
      repositories: { repositoryIds: [], primaryRepositoryId: null },
      variables: [],
      graph: { startNodeId: null, nodes: [], edges: [], maxTransitions: 0 },
    })
    const unavailableHarness = WorkflowFileSchema.parse({
      ...workflowFile,
      graph: {
        ...workflowFile.graph,
        nodes: [
          {
            ...workflowFile.graph.nodes[0],
            harness: { harnessId: 'supported-but-not-installed' },
          },
        ],
      },
    })

    expect(validateWorkflow(workflowFileToWorkflow(draft))).toMatchObject({ valid: true })
    expect(validateWorkflow(workflowFileToWorkflow(unavailableHarness))).toMatchObject({
      valid: true,
    })
  })
})
