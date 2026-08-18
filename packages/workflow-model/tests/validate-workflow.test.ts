import { describe, expect, it } from 'vitest'

import { validateWorkflow } from '../src/index.js'

const registeredCommandIds = new Set(['verify-selected-repositories'])

const agentNode = {
  type: 'agent',
  id: 'start',
  name: 'Start',
  description: 'Start the workflow.',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  thinkingLevel: 'high',
  promptTemplate: 'Begin the task.',
  workspacePolicy: 'selected-worktrees',
  permissionProfile: 'read-only',
  resourceBundleId: 'delivery-start',
  inputArtifacts: [],
  outputSchemaRef: 'workflow-output/start-v1',
  outcomes: ['ready'],
  timeoutSeconds: 900,
}

const commandNode = {
  type: 'command',
  id: 'verify',
  name: 'Verify',
  description: 'Run repository checks.',
  commandId: 'verify-selected-repositories',
  outcomes: ['passed', 'retry'],
  timeoutSeconds: 1_800,
}

const terminalNode = {
  type: 'terminal',
  id: 'done',
  name: 'Done',
  terminalStatus: 'SUCCEEDED',
}

const validWorkflow = {
  workflowId: 'delivery-workflow',
  revisionId: 'revision-01',
  name: 'Delivery workflow',
  description: 'Deliver one approved task.',
  startNodeId: 'start',
  nodes: [agentNode, commandNode, terminalNode],
  edges: [
    { sourceNodeId: 'start', outcome: 'ready', targetNodeId: 'verify', label: 'Ready' },
    { sourceNodeId: 'verify', outcome: 'passed', targetNodeId: 'done', label: 'Passed' },
    { sourceNodeId: 'verify', outcome: 'retry', targetNodeId: 'verify', label: 'Retry' },
  ],
  maxTransitions: 24,
  createdAt: '2026-08-18T20:00:00Z',
}

describe('validateWorkflow', () => {
  it('accepts a valid cyclic workflow without proving termination', () => {
    const result = validateWorkflow(validWorkflow, { registeredCommandIds })

    expect(result.valid).toBe(true)
    expect(result.findings).toEqual([])
    if (result.valid) {
      expect(result.workflow).toEqual(validWorkflow)
      expect(Object.isFrozen(result.workflow)).toBe(true)
    }
  })

  it.each([
    ['missing node ID', { ...agentNode, id: undefined }, ['nodes', 0, 'id']],
    ['malformed node ID', { ...agentNode, id: 'Start Node' }, ['nodes', 0, 'id']],
    ['missing agent provider', { ...agentNode, provider: undefined }, ['nodes', 0, 'provider']],
  ])('returns a field-addressable schema finding for %s', (_case, node, path) => {
    const result = validateWorkflow(
      { ...validWorkflow, nodes: [node, commandNode, terminalNode] },
      {
        registeredCommandIds,
      },
    )

    expect(result.valid).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'SCHEMA_INVALID', path }),
    )
  })

  it('returns a field-addressable schema finding for a non-positive transition limit', () => {
    const result = validateWorkflow(
      { ...validWorkflow, maxTransitions: 0 },
      { registeredCommandIds },
    )

    expect(result.valid).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'SCHEMA_INVALID', path: ['maxTransitions'] }),
    )
  })

  it('reports duplicate node IDs and an ambiguous start', () => {
    const duplicateStart = { ...commandNode, id: 'start' }
    const result = validateWorkflow(
      { ...validWorkflow, nodes: [agentNode, duplicateStart, terminalNode] },
      { registeredCommandIds },
    )

    expect(result.valid).toBe(false)
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DUPLICATE_NODE_ID', path: ['nodes', 1, 'id'] }),
        expect.objectContaining({ code: 'START_NODE_AMBIGUOUS', path: ['startNodeId'] }),
      ]),
    )
  })

  it('reports a start node that does not exist', () => {
    const result = validateWorkflow(
      { ...validWorkflow, startNodeId: 'missing' },
      {
        registeredCommandIds,
      },
    )

    expect(result.valid).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'START_NODE_NOT_FOUND', path: ['startNodeId'] }),
    )
  })

  it('reports a workflow without a terminal node', () => {
    const result = validateWorkflow(
      { ...validWorkflow, nodes: [agentNode, commandNode] },
      {
        registeredCommandIds,
      },
    )

    expect(result.valid).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'TERMINAL_NODE_MISSING', path: ['nodes'] }),
    )
  })

  it('reports edges whose source or target does not exist', () => {
    const result = validateWorkflow(
      {
        ...validWorkflow,
        edges: [
          ...validWorkflow.edges,
          { sourceNodeId: 'missing', outcome: 'ready', targetNodeId: 'done', label: 'Missing' },
          { sourceNodeId: 'start', outcome: 'ready', targetNodeId: 'missing', label: 'Missing' },
        ],
      },
      { registeredCommandIds },
    )

    expect(result.valid).toBe(false)
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'EDGE_SOURCE_NOT_FOUND',
          path: ['edges', 3, 'sourceNodeId'],
        }),
        expect.objectContaining({
          code: 'EDGE_TARGET_NOT_FOUND',
          path: ['edges', 4, 'targetNodeId'],
        }),
      ]),
    )
  })

  it('reports an incoming edge to the start node', () => {
    const result = validateWorkflow(
      {
        ...validWorkflow,
        edges: [
          ...validWorkflow.edges,
          { sourceNodeId: 'verify', outcome: 'passed', targetNodeId: 'start', label: 'Invalid' },
        ],
      },
      { registeredCommandIds },
    )

    expect(result.valid).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'START_NODE_HAS_INCOMING_EDGE',
        path: ['edges', 3, 'targetNodeId'],
      }),
    )
  })

  it('reports an outgoing edge from a terminal node', () => {
    const result = validateWorkflow(
      {
        ...validWorkflow,
        edges: [
          ...validWorkflow.edges,
          { sourceNodeId: 'done', outcome: 'again', targetNodeId: 'verify', label: 'Invalid' },
        ],
      },
      { registeredCommandIds },
    )

    expect(result.valid).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'TERMINAL_NODE_HAS_OUTGOING_EDGE',
        path: ['edges', 3, 'sourceNodeId'],
      }),
    )
  })

  it('reports an edge using an undeclared outcome', () => {
    const result = validateWorkflow(
      {
        ...validWorkflow,
        edges: [
          ...validWorkflow.edges,
          { sourceNodeId: 'verify', outcome: 'unknown', targetNodeId: 'done', label: 'Unknown' },
        ],
      },
      { registeredCommandIds },
    )

    expect(result.valid).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'EDGE_OUTCOME_UNDECLARED', path: ['edges', 3, 'outcome'] }),
    )
  })

  it('reports a declared outcome without an edge', () => {
    const result = validateWorkflow(
      { ...validWorkflow, edges: validWorkflow.edges.filter((edge) => edge.outcome !== 'retry') },
      { registeredCommandIds },
    )

    expect(result.valid).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'OUTCOME_EDGE_MISSING', path: ['nodes', 1, 'outcomes', 1] }),
    )
  })

  it('reports a declared outcome with multiple edges', () => {
    const result = validateWorkflow(
      {
        ...validWorkflow,
        edges: [
          ...validWorkflow.edges,
          { sourceNodeId: 'verify', outcome: 'passed', targetNodeId: 'verify', label: 'Duplicate' },
        ],
      },
      { registeredCommandIds },
    )

    expect(result.valid).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'OUTCOME_EDGE_AMBIGUOUS',
        path: ['nodes', 1, 'outcomes', 0],
      }),
    )
  })

  it('reports a node unreachable from the explicit start', () => {
    const unreachable = { ...terminalNode, id: 'abandoned', name: 'Abandoned' }
    const result = validateWorkflow(
      { ...validWorkflow, nodes: [...validWorkflow.nodes, unreachable] },
      { registeredCommandIds },
    )

    expect(result.valid).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'NODE_UNREACHABLE', path: ['nodes', 3, 'id'] }),
    )
  })

  it('reports a command node whose command is not registered', () => {
    const result = validateWorkflow(validWorkflow, { registeredCommandIds: new Set() })

    expect(result.valid).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'COMMAND_UNREGISTERED', path: ['nodes', 1, 'commandId'] }),
    )
  })
})
