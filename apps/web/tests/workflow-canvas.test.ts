import { describe, expect, it } from 'vitest'

import { AgentNodeSchema, WorkflowEdgeSchema, type Workflow } from '@slopify/workflow-model'

import { layoutWorkflowGraph } from '../lib/workflow-graph-layout'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const workflow = createAgentWorkflowFixture({
  createdAt: '2026-08-18T12:00:00Z',
  modelId: 'test-model',
  thinkingLevel: 'high',
})

describe('workflow graph layout', () => {
  it('renders agent nodes with stable positions', () => {
    const first = layoutWorkflowGraph(workflow, { editable: true })
    const second = layoutWorkflowGraph(workflow, { editable: true })

    expect(first.nodes).toHaveLength(1)
    expect(first.edges).toHaveLength(0)
    expect(first.nodes.map(({ id }) => id)).toEqual(workflow.nodes.map(({ id }) => id))
    expect(first.nodes.map(({ position }) => position)).toEqual(
      second.nodes.map(({ position }) => position),
    )
    expect(first.nodes.every(({ draggable, connectable }) => !draggable && connectable)).toBe(true)
    expect(first.nodes[0]?.data).toMatchObject({ isStart: true, isEnd: true })
  })

  it('marks only the leaf as end, exposes branching actions, and omits edge labels', () => {
    const firstAgent = workflow.nodes[0]
    if (firstAgent === undefined) throw new Error('Expected an agent fixture')
    const secondAgent = AgentNodeSchema.parse({
      ...firstAgent,
      id: 'review-agent',
      name: 'Review agent',
    })
    const connectedWorkflow = {
      ...workflow,
      nodes: [firstAgent, secondAgent],
      edges: [
        WorkflowEdgeSchema.parse({
          sourceNodeId: firstAgent.id,
          targetNodeId: secondAgent.id,
          outcome: 'completed',
          label: 'Completed',
        }),
      ],
    } as Workflow
    const onAddAgent = () => undefined

    const graph = layoutWorkflowGraph(connectedWorkflow, { onAddAgent })
    const start = graph.nodes.find(({ id }) => id === firstAgent.id)
    const end = graph.nodes.find(({ id }) => id === secondAgent.id)

    expect(start?.data).toMatchObject({ isStart: true, isEnd: false })
    expect(start?.data.onAddAgent).toBeTypeOf('function')
    expect(end?.data).toMatchObject({ isStart: false, isEnd: true })
    expect(end?.data.onAddAgent).toBeTypeOf('function')
    expect(graph.edges[0]?.label).toBeUndefined()
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
