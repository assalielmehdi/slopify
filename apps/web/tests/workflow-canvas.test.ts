import { describe, expect, it } from 'vitest'

import { createPredefinedV1Workflow, type Workflow } from '@slopify/workflow-model'

import { layoutWorkflowGraph } from '../components/workflow/workflow-canvas'

const workflow = createPredefinedV1Workflow({
  createdAt: '2026-08-18T12:00:00Z',
  agentDefaults: {
    provider: 'test-provider',
    model: 'test-model',
    thinkingLevel: 'high',
  },
})

describe('workflow graph layout', () => {
  it('renders only agent jobs with stable positions', () => {
    const first = layoutWorkflowGraph(workflow)
    const second = layoutWorkflowGraph(workflow)

    expect(first.nodes).toHaveLength(1)
    expect(first.edges).toHaveLength(0)
    expect(first.nodes.map(({ id }) => id)).toEqual(
      workflow.nodes.filter(({ type }) => type === 'agent').map(({ id }) => id),
    )
    expect(first.nodes.map(({ position }) => position)).toEqual(
      second.nodes.map(({ position }) => position),
    )
    expect(first.nodes.every(({ draggable, connectable }) => !draggable && !connectable)).toBe(true)
  })

  it('does not expose command, router, terminal, or edges to hidden nodes', () => {
    const workflowWithDeferredNodes = {
      ...workflow,
      nodes: [
        ...workflow.nodes,
        {
          type: 'command',
          id: 'hidden-command',
          name: 'Hidden command',
          description: 'Deferred in V1',
          commandId: 'deferred',
          outcomes: ['success'],
          timeoutSeconds: 60,
        },
        {
          type: 'router',
          id: 'hidden-router',
          name: 'Hidden router',
          description: 'Deferred in V1',
          inputField: 'route',
          outcomes: ['success'],
        },
        {
          type: 'terminal',
          id: 'hidden-terminal',
          name: 'Hidden terminal',
          terminalStatus: 'SUCCEEDED',
        },
      ],
      edges: [
        {
          sourceNodeId: workflow.startNodeId,
          outcome: 'success',
          targetNodeId: 'hidden-command',
          label: 'Hidden transition',
        },
      ],
    } as unknown as Workflow

    const graph = layoutWorkflowGraph(workflowWithDeferredNodes)

    expect(graph.nodes.find(({ id }) => id === workflow.startNodeId)?.data.isStart).toBe(true)
    expect(graph.nodes.map(({ id }) => id)).not.toContain('hidden-command')
    expect(graph.nodes.map(({ id }) => id)).not.toContain('hidden-router')
    expect(graph.nodes.map(({ id }) => id)).not.toContain('hidden-terminal')
    expect(graph.edges).toHaveLength(0)
  })

  it('returns an empty graph for a zero-node workflow', () => {
    const emptyWorkflow = {
      ...workflow,
      startNodeId: null,
      nodes: [],
      edges: [],
    } as unknown as Workflow

    expect(layoutWorkflowGraph(emptyWorkflow)).toEqual({ nodes: [], edges: [] })
  })
})
