import { describe, expect, it } from 'vitest'

import {
  WorkflowSchema,
  getDeclaredOutcomes,
  getIncomingEdges,
  getOutgoingEdges,
  getReachableNodeIds,
  hasDirectedCycle,
} from '../src/index.js'

const agent = (id: string) => ({
  type: 'agent',
  id,
  name: id,
  prompt: `Complete ${id}.`,
  harness: { harnessId: 'pi' },
})

const workflow = WorkflowSchema.parse({
  schemaVersion: 3,
  workflowId: 'workflow-01',
  description: 'Coordinate agents.',
  configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
  startNodeId: 'start',
  nodes: [agent('start'), agent('review'), agent('done')],
  edges: [
    { sourceNodeId: 'start', outcome: 'ready', targetNodeId: 'review', label: 'Ready' },
    { sourceNodeId: 'review', outcome: 'clean', targetNodeId: 'done', label: 'Clean' },
    { sourceNodeId: 'review', outcome: 'retry', targetNodeId: 'review', label: 'Retry' },
  ],
  maxTransitions: 24,
  createdAt: '2026-08-18T20:00:00Z',
  updatedAt: '2026-08-18T20:00:00Z',
})

describe('workflow graph queries', () => {
  it('returns graph relationships and outcomes in workflow order', () => {
    expect(getIncomingEdges(workflow, 'review')).toEqual([workflow.edges[0], workflow.edges[2]])
    expect(getOutgoingEdges(workflow, 'review')).toEqual([workflow.edges[1], workflow.edges[2]])
    expect(getDeclaredOutcomes(workflow, 'review')).toEqual(['clean', 'retry'])
    expect(getReachableNodeIds(workflow)).toEqual(['start', 'review', 'done'])
  })

  it('detects cycles without rejecting them', () => {
    expect(hasDirectedCycle(workflow)).toBe(true)
    expect(
      hasDirectedCycle(
        WorkflowSchema.parse({
          ...workflow,
          edges: workflow.edges.filter((edge) => edge.outcome !== 'retry'),
        }),
      ),
    ).toBe(false)
  })
})
