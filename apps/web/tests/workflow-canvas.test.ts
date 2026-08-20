import { describe, expect, it } from 'vitest'

import { createPredefinedV1Revision } from '@loop/workflow-model'

import { layoutWorkflowGraph } from '../components/workflow/workflow-canvas'

const revision = createPredefinedV1Revision({
  revisionId: 'revision-01',
  createdAt: '2026-08-18T12:00:00Z',
  agentDefaults: {
    provider: 'test-provider',
    model: 'test-model',
    thinkingLevel: 'high',
  },
})

describe('workflow graph layout', () => {
  it('renders every immutable node, outcome, and edge with stable positions', () => {
    const first = layoutWorkflowGraph(revision)
    const second = layoutWorkflowGraph(revision)

    expect(first.nodes).toHaveLength(14)
    expect(first.edges).toHaveLength(21)
    expect(first.nodes.map(({ id }) => id)).toEqual(revision.nodes.map(({ id }) => id))
    expect(first.edges.map(({ label }) => label)).toEqual(
      revision.edges.map(({ outcome, label }) => `${outcome}: ${label}`),
    )
    expect(first.nodes.map(({ position }) => position)).toEqual(
      second.nodes.map(({ position }) => position),
    )
    expect(first.nodes.every(({ draggable, connectable }) => !draggable && !connectable)).toBe(true)
  })

  it('marks start and terminal nodes without changing the domain topology', () => {
    const graph = layoutWorkflowGraph(revision)

    expect(graph.nodes.find(({ id }) => id === revision.startNodeId)?.data.isStart).toBe(true)
    expect(graph.nodes.filter(({ data }) => data.isTerminal).map(({ id }) => id)).toEqual([
      'failed',
      'succeeded',
    ])
    expect(graph.edges.map(({ source, target }) => [source, target])).toEqual(
      revision.edges.map(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId]),
    )
    expect(graph.nodes.find(({ id }) => id === 'failed')?.ariaLabel).toBe('Failed, terminal node')
  })
})
