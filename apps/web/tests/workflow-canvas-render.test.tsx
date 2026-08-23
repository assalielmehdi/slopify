// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactFlowProps } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkflowCanvas } from '../components/workflow/workflow-canvas'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const flowRenders = vi.hoisted(
  () =>
    [] as {
      readonly nodes: ReactFlowProps['nodes']
      readonly edges: ReactFlowProps['edges']
      readonly onNodesChange: ReactFlowProps['onNodesChange']
      readonly onConnect: ReactFlowProps['onConnect']
      readonly onEdgesDelete: ReactFlowProps['onEdgesDelete']
      readonly nodesConnectable: ReactFlowProps['nodesConnectable']
    }[],
)

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()

  return {
    ...actual,
    Background: () => null,
    Controls: () => null,
    Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ReactFlow: ({
      children,
      edges,
      nodes,
      nodesConnectable,
      onConnect,
      onEdgesDelete,
      onNodesChange,
    }: ReactFlowProps) => {
      flowRenders.push({ edges, nodes, nodesConnectable, onConnect, onEdgesDelete, onNodesChange })
      return <div>{children}</div>
    },
  }
})

const workflow = createAgentWorkflowFixture({
  createdAt: '2026-08-18T12:00:00Z',
  modelId: 'test-model',
  thinkingLevel: 'high',
})

afterEach(() => {
  cleanup()
  flowRenders.length = 0
})

describe('WorkflowCanvas rendering', () => {
  it('keeps renderer input references stable across equivalent parent renders', () => {
    const onNodeSelect = vi.fn()
    const onAddAgent = vi.fn()
    const onConnect = vi.fn()
    const onEdgeDelete = vi.fn()
    const onRun = vi.fn()
    const onConfigure = vi.fn()
    const view = render(
      <>
        <input aria-label="Agent name" />
        <WorkflowCanvas
          workflow={workflow}
          selectedNodeId={workflow.startNodeId}
          onNodeSelect={onNodeSelect}
          onAddAgent={onAddAgent}
          onConnect={onConnect}
          onEdgeDelete={onEdgeDelete}
          onRun={onRun}
          onConfigure={onConfigure}
          runnable
        />
      </>,
    )

    view.rerender(
      <>
        <input aria-label="Agent name" />
        <WorkflowCanvas
          workflow={workflow}
          selectedNodeId={workflow.startNodeId}
          onNodeSelect={onNodeSelect}
          onAddAgent={onAddAgent}
          onConnect={onConnect}
          onEdgeDelete={onEdgeDelete}
          onRun={onRun}
          onConfigure={onConfigure}
          runnable
        />
      </>,
    )

    expect(flowRenders).toHaveLength(2)
    expect(flowRenders[1]?.nodes).toBe(flowRenders[0]?.nodes)
    expect(flowRenders[1]?.edges).toBe(flowRenders[0]?.edges)
    expect(flowRenders[1]?.onNodesChange).toBe(flowRenders[0]?.onNodesChange)
    expect(flowRenders[1]?.onNodesChange).toBeTypeOf('function')
    flowRenders[1]?.onNodesChange?.([{ id: 'prepare-worktrees', type: 'select', selected: true }])
    expect(onNodeSelect).toHaveBeenCalledWith('prepare-worktrees')
    expect(flowRenders[1]?.nodesConnectable).toBe(true)
    flowRenders[1]?.onConnect?.({
      source: 'identify-agent',
      target: 'review-agent',
      sourceHandle: null,
      targetHandle: null,
    })
    expect(onConnect).toHaveBeenCalledWith('identify-agent', 'review-agent')
    const addFromNode = flowRenders[1]?.nodes?.[0]?.data.onAddAgent as (() => void) | undefined
    addFromNode?.()
    expect(onAddAgent).toHaveBeenCalledWith('identify-agent')
    const runButton = screen.getByRole('button', { name: 'Run' })
    fireEvent.click(screen.getByRole('button', { name: 'Configure workflow' }))
    expect(onConfigure).toHaveBeenCalledOnce()
    expect(runButton.getAttribute('aria-keyshortcuts')).toBe('R')
    expect(runButton.className).toContain('t-resize')
    expect(runButton.className).toContain('w-8')
    expect(runButton.className).toContain('hover:w-max')
    expect(runButton.className).not.toMatch(/hover:w-\d/)
    expect(runButton.className).toContain('gap-2')
    expect(runButton.querySelector('span')?.className).not.toContain('max-w-0')
    expect(runButton.getAttribute('data-slot')).toBe('tooltip-trigger')
    fireEvent.keyDown(window, { key: 'r' })
    expect(onRun).toHaveBeenCalledTimes(1)
    const agentName = screen.getByRole('textbox', { name: 'Agent name' })
    agentName.focus()
    fireEvent.keyDown(agentName, { key: 'r' })
    expect(onRun).toHaveBeenCalledTimes(1)
    const graph = screen.getByRole('region', { name: 'Workflow graph' })
    expect(graph.className).toContain('workflow-graph')
    expect(graph.className).not.toContain('border')
    expect(graph.className).not.toContain('rounded')
  })

  it('shows disabled action reasons without relying on inaccessible title text', () => {
    render(
      <WorkflowCanvas
        workflow={workflow}
        onNodeSelect={vi.fn()}
        onAddAgent={vi.fn()}
        onRun={vi.fn()}
        addAgentDisabledReason="Pi is unavailable. Open Harnesses for installation instructions."
        runDisabledReason="Pi is unavailable. Open Harnesses before running."
      />,
    )

    const status = screen.getByRole('status', { name: 'Workflow actions unavailable' })
    expect(status.textContent).toContain('Open Harnesses')
    expect(screen.getByRole('button', { name: 'Run' }).getAttribute('aria-describedby')).toBe(
      status.id,
    )
  })
})
