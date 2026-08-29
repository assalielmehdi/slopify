import { describe, expect, it } from 'vitest'

import { validateWorkflow } from '../../src/index.js'

const agent = (id: string) => ({
  type: 'agent',
  id,
  name: id,
  prompt: `Complete ${id}.`,
  harness: { harnessId: 'pi' },
})

const validWorkflow = {
  schemaVersion: 3,
  workflowId: 'workflow-01',
  description: 'Coordinate agents.',
  configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
  startNodeId: 'start',
  nodes: [agent('start'), agent('review')],
  edges: [
    { sourceNodeId: 'start', outcome: 'completed', targetNodeId: 'review', label: 'Completed' },
  ],
  maxTransitions: 24,
  createdAt: '2026-08-18T20:00:00Z',
  updatedAt: '2026-08-18T20:00:00Z',
}

describe('validateWorkflow', () => {
  it('accepts an agent graph without external registries', () => {
    const result = validateWorkflow(validWorkflow)

    expect(result).toMatchObject({ valid: true, findings: [] })
    if (result.valid) expect(Object.isFrozen(result.workflow)).toBe(true)
  })

  it.each([
    ['missing node ID', { ...agent('start'), id: undefined }, ['nodes', 0, 'id']],
    ['malformed node ID', { ...agent('start'), id: 'Start Node' }, ['nodes', 0, 'id']],
    ['missing agent prompt', { ...agent('start'), prompt: undefined }, ['nodes', 0, 'prompt']],
  ])('returns a field-addressable schema finding for %s', (_case, node, path) => {
    const result = validateWorkflow({ ...validWorkflow, nodes: [node, agent('review')] })

    expect(result.valid).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'SCHEMA_INVALID', path }),
    )
  })

  it('accepts empty drafts and one-agent leaf workflows', () => {
    expect(
      validateWorkflow({
        ...validWorkflow,
        startNodeId: null,
        nodes: [],
        edges: [],
        maxTransitions: 0,
      }),
    ).toMatchObject({ valid: true, findings: [] })
    expect(
      validateWorkflow({
        ...validWorkflow,
        nodes: [agent('start')],
        edges: [],
        maxTransitions: 0,
      }),
    ).toMatchObject({ valid: true, findings: [] })
  })

  it('requires one unambiguous start when nodes exist', () => {
    const missing = validateWorkflow({ ...validWorkflow, startNodeId: 'missing' })
    const required = validateWorkflow({ ...validWorkflow, startNodeId: null })
    const ambiguous = validateWorkflow({
      ...validWorkflow,
      nodes: [agent('start'), agent('start')],
      edges: [],
    })

    expect(missing.findings).toContainEqual(
      expect.objectContaining({ code: 'START_NODE_NOT_FOUND', path: ['startNodeId'] }),
    )
    expect(required.findings).toContainEqual(
      expect.objectContaining({ code: 'START_NODE_REQUIRED', path: ['startNodeId'] }),
    )
    expect(ambiguous.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DUPLICATE_NODE_ID', path: ['nodes', 1, 'id'] }),
        expect.objectContaining({ code: 'START_NODE_AMBIGUOUS', path: ['startNodeId'] }),
      ]),
    )
  })

  it('reports unknown edge endpoints and incoming edges to the start', () => {
    const result = validateWorkflow({
      ...validWorkflow,
      edges: [
        ...validWorkflow.edges,
        { sourceNodeId: 'missing', outcome: 'done', targetNodeId: 'review', label: 'Missing' },
        { sourceNodeId: 'start', outcome: 'done', targetNodeId: 'missing', label: 'Missing' },
        { sourceNodeId: 'review', outcome: 'retry', targetNodeId: 'start', label: 'Retry' },
      ],
    })

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'EDGE_SOURCE_NOT_FOUND' }),
        expect.objectContaining({ code: 'EDGE_TARGET_NOT_FOUND' }),
        expect.objectContaining({ code: 'START_NODE_HAS_INCOMING_EDGE' }),
      ]),
    )
  })

  it('accepts cycles and explicit fan-out', () => {
    expect(
      validateWorkflow({
        ...validWorkflow,
        edges: [
          ...validWorkflow.edges,
          { sourceNodeId: 'review', outcome: 'retry', targetNodeId: 'review', label: 'Retry' },
        ],
      }).valid,
    ).toBe(true)

    const third = agent('third')
    expect(
      validateWorkflow({
        ...validWorkflow,
        nodes: [...validWorkflow.nodes, third],
        edges: [
          ...validWorkflow.edges,
          { sourceNodeId: 'start', outcome: 'completed', targetNodeId: 'third', label: 'Also' },
        ],
      }).valid,
    ).toBe(true)
  })

  it('reports nodes unreachable from the start', () => {
    const result = validateWorkflow({
      ...validWorkflow,
      nodes: [...validWorkflow.nodes, agent('abandoned')],
    })

    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'NODE_UNREACHABLE', path: ['nodes', 2, 'id'] }),
    )
  })
})
