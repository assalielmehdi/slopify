import { describe, expect, it } from 'vitest'

import { AgentNodeSchema, WorkflowEdgeSchema, type Workflow } from '@slopify/shared'

import { layoutWorkflowGraph, workflowGraphPaneWidth } from '../lib/workflow-graph-layout'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const workflow = createAgentWorkflowFixture({
  createdAt: '2026-08-18T12:00:00Z',
  modelId: 'test-model',
  thinkingLevel: 'high',
})

describe('workflow graph layout', () => {
  it('renders agent nodes with stable positions', () => {
    const first = layoutWorkflowGraph(workflow)
    const second = layoutWorkflowGraph(workflow)

    expect(first.nodes).toHaveLength(1)
    expect(first.edges).toHaveLength(0)
    expect(first.nodes.map(({ id }) => id)).toEqual(workflow.nodes.map(({ id }) => id))
    expect(first.nodes.map(({ position }) => position)).toEqual(
      second.nodes.map(({ position }) => position),
    )
    expect(first.nodes[0]?.data).toMatchObject({ isStart: true, isEnd: true })
    expect(first.nodes[0]?.ariaLabel).toBe(
      'Who are you?, agent node, start node, end node, pi harness, model test-model, thinking effort high',
    )
    expect(first.width).toBeGreaterThan(0)
    expect(first.height).toBeGreaterThan(0)
  })

  it('marks only the leaf as end and lays out labelled transitions', () => {
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
    const graph = layoutWorkflowGraph(connectedWorkflow)
    const start = graph.nodes.find(({ id }) => id === firstAgent.id)
    const end = graph.nodes.find(({ id }) => id === secondAgent.id)

    expect(start?.data).toMatchObject({ isStart: true, isEnd: false })
    expect(end?.data).toMatchObject({ isStart: false, isEnd: true })
    expect(graph.edges[0]).toMatchObject({
      sourceNodeId: firstAgent.id,
      targetNodeId: secondAgent.id,
      outcome: 'completed',
      label: 'Completed',
    })
    expect(graph.edges[0]?.points.length).toBeGreaterThan(1)
  })

  it('returns an empty graph for a zero-node workflow', () => {
    const emptyWorkflow = {
      ...workflow,
      startNodeId: null,
      nodes: [],
      edges: [],
    } as unknown as Workflow

    expect(layoutWorkflowGraph(emptyWorkflow)).toEqual({
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
    })
  })

  it('sizes the graph pane from the widest parallel rank', () => {
    const firstAgent = workflow.nodes[0]
    if (firstAgent === undefined) throw new Error('Expected an agent fixture')
    const secondAgent = AgentNodeSchema.parse({
      ...firstAgent,
      id: 'review-agent',
      name: 'Review agent',
    })
    const thirdAgent = AgentNodeSchema.parse({
      ...firstAgent,
      id: 'test-agent',
      name: 'Test agent',
    })
    const linearWorkflow = {
      ...workflow,
      nodes: [firstAgent, secondAgent, thirdAgent],
      edges: [
        WorkflowEdgeSchema.parse({
          sourceNodeId: firstAgent.id,
          targetNodeId: secondAgent.id,
          outcome: 'completed',
          label: 'Review',
        }),
        WorkflowEdgeSchema.parse({
          sourceNodeId: secondAgent.id,
          targetNodeId: thirdAgent.id,
          outcome: 'completed',
          label: 'Test',
        }),
      ],
    } as Workflow
    const parallelWorkflow = {
      ...linearWorkflow,
      edges: [
        WorkflowEdgeSchema.parse({
          sourceNodeId: firstAgent.id,
          targetNodeId: secondAgent.id,
          outcome: 'review',
          label: 'Review',
        }),
        WorkflowEdgeSchema.parse({
          sourceNodeId: firstAgent.id,
          targetNodeId: thirdAgent.id,
          outcome: 'test',
          label: 'Test',
        }),
      ],
    } as Workflow

    expect(workflowGraphPaneWidth(parallelWorkflow)).toBeGreaterThan(
      workflowGraphPaneWidth(linearWorkflow),
    )
    expect(workflowGraphPaneWidth(linearWorkflow)).toBe(
      layoutWorkflowGraph(linearWorkflow).width + 64,
    )
  })
})
