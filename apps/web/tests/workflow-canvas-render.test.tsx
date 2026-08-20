// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import type { ReactFlowProps } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPredefinedV1Revision } from '@loop/workflow-model'

import { WorkflowCanvas } from '../components/workflow/workflow-canvas'

const flowRenders = vi.hoisted(
  () =>
    [] as {
      readonly nodes: ReactFlowProps['nodes']
      readonly edges: ReactFlowProps['edges']
      readonly onNodesChange: ReactFlowProps['onNodesChange']
    }[],
)

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()

  return {
    ...actual,
    Background: () => null,
    Controls: () => null,
    ReactFlow: ({ children, edges, nodes, onNodesChange }: ReactFlowProps) => {
      flowRenders.push({ edges, nodes, onNodesChange })
      return <div>{children}</div>
    },
  }
})

const revision = createPredefinedV1Revision({
  revisionId: 'revision-01',
  createdAt: '2026-08-18T12:00:00Z',
  agentDefaults: {
    provider: 'test-provider',
    model: 'test-model',
    thinkingLevel: 'high',
  },
})

afterEach(() => {
  cleanup()
  flowRenders.length = 0
})

describe('WorkflowCanvas rendering', () => {
  it('keeps renderer input references stable across equivalent parent renders', () => {
    const onNodeSelect = vi.fn()
    const view = render(
      <WorkflowCanvas
        revision={revision}
        selectedNodeId={revision.startNodeId}
        onNodeSelect={onNodeSelect}
      />,
    )

    view.rerender(
      <WorkflowCanvas
        revision={revision}
        selectedNodeId={revision.startNodeId}
        onNodeSelect={onNodeSelect}
      />,
    )

    expect(flowRenders).toHaveLength(2)
    expect(flowRenders[1]?.nodes).toBe(flowRenders[0]?.nodes)
    expect(flowRenders[1]?.edges).toBe(flowRenders[0]?.edges)
    expect(flowRenders[1]?.onNodesChange).toBe(flowRenders[0]?.onNodesChange)
    expect(flowRenders[1]?.onNodesChange).toBeTypeOf('function')
    flowRenders[1]?.onNodesChange?.([{ id: 'prepare-worktrees', type: 'select', selected: true }])
    expect(onNodeSelect).toHaveBeenCalledWith('prepare-worktrees')
    expect(screen.getByRole('region', { name: 'Workflow graph' }).className).toContain(
      'workflow-graph',
    )
  })
})
