import { describe, expect, it } from 'vitest'

import {
  WorkflowRevisionSchema,
  getIncomingEdges,
  getOutgoingEdges,
  getReachableNodeIds,
  hasDirectedCycle,
  inspectWorkflowGraph,
} from '../src/index.js'

const workflow = WorkflowRevisionSchema.parse({
  workflowId: 'delivery-workflow',
  revisionId: 'revision-01',
  name: 'Delivery workflow',
  description: 'Deliver one approved task.',
  startNodeId: 'start',
  nodes: [
    {
      type: 'command',
      id: 'start',
      name: 'Start',
      description: 'Start the workflow.',
      commandId: 'start-workflow',
      outcomes: ['ready'],
      timeoutSeconds: 30,
    },
    {
      type: 'router',
      id: 'review',
      name: 'Review',
      description: 'Route review results.',
      inputField: 'review.result',
      outcomes: ['clean', 'retry'],
    },
    { type: 'terminal', id: 'done', name: 'Done', terminalStatus: 'SUCCEEDED' },
  ],
  edges: [
    { sourceNodeId: 'start', outcome: 'ready', targetNodeId: 'review', label: 'Ready' },
    { sourceNodeId: 'review', outcome: 'clean', targetNodeId: 'done', label: 'Clean' },
    { sourceNodeId: 'review', outcome: 'retry', targetNodeId: 'review', label: 'Retry' },
  ],
  maxTransitions: 24,
  createdAt: '2026-08-18T20:00:00Z',
})

describe('workflow graph queries', () => {
  it('returns incoming and outgoing edges in workflow order', () => {
    expect(getIncomingEdges(workflow, 'review')).toEqual([workflow.edges[0], workflow.edges[2]])
    expect(getOutgoingEdges(workflow, 'review')).toEqual([workflow.edges[1], workflow.edges[2]])
  })

  it('returns reachable node IDs in workflow order', () => {
    expect(getReachableNodeIds(workflow)).toEqual(['start', 'review', 'done'])
  })

  it('detects a directed cycle without rejecting it', () => {
    expect(hasDirectedCycle(workflow)).toBe(true)

    const acyclic = WorkflowRevisionSchema.parse({
      ...workflow,
      revisionId: 'revision-02',
      edges: workflow.edges.filter((edge) => edge.outcome !== 'retry'),
    })
    expect(hasDirectedCycle(acyclic)).toBe(false)
  })

  it('builds frozen display-ready node relationships', () => {
    const inspection = inspectWorkflowGraph(workflow)

    expect(inspection.hasCycle).toBe(true)
    expect(inspection.nodes).toEqual([
      expect.objectContaining({ node: workflow.nodes[0], isStart: true, isTerminal: false }),
      expect.objectContaining({
        node: workflow.nodes[1],
        isStart: false,
        isTerminal: false,
        incomingEdges: [workflow.edges[0], workflow.edges[2]],
        outgoingEdges: [workflow.edges[1], workflow.edges[2]],
      }),
      expect.objectContaining({ node: workflow.nodes[2], isStart: false, isTerminal: true }),
    ])
    expect(Object.isFrozen(inspection)).toBe(true)
    expect(Object.isFrozen(inspection.nodes)).toBe(true)
    expect(inspection.nodes.every(Object.isFrozen)).toBe(true)
    expect(inspection.nodes.every((node) => Object.isFrozen(node.incomingEdges))).toBe(true)
    expect(inspection.nodes.every((node) => Object.isFrozen(node.outgoingEdges))).toBe(true)
  })
})
