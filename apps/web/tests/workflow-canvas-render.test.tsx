// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentNodeSchema, WorkflowEdgeSchema, type Workflow } from '@slopify/workflow-model'

import { WorkflowCanvas } from '../components/workflow/workflow-canvas'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const workflow = createAgentWorkflowFixture({
  createdAt: '2026-08-18T12:00:00Z',
  modelId: 'test-model',
  thinkingLevel: 'high',
})

afterEach(cleanup)

describe('WorkflowCanvas rendering', () => {
  it('renders a deterministic read-only graph with accessible nodes and transitions', () => {
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
    const onNodeSelect = vi.fn()
    const onRun = vi.fn()
    const onConfigure = vi.fn()

    const { container } = render(
      <>
        <input aria-label="Agent name" />
        <WorkflowCanvas
          workflow={connectedWorkflow}
          selectedNodeId={firstAgent.id}
          onNodeSelect={onNodeSelect}
          onRun={onRun}
          onConfigure={onConfigure}
          runnable
        />
      </>,
    )

    const graph = screen.getByRole('region', { name: 'Workflow graph' })
    expect(within(graph).getAllByRole('button', { name: /agent node/i })).toHaveLength(2)
    fireEvent.click(within(graph).getByRole('button', { name: /Review agent, agent node/i }))
    expect(onNodeSelect).toHaveBeenCalledWith('review-agent')
    expect(within(graph).getByRole('list', { name: 'Workflow transitions' }).textContent).toContain(
      'Who are you? to Review agent: Completed (completed)',
    )
    expect(container.querySelector('svg[aria-hidden="true"] path')).toBeTruthy()
    expect(container.querySelector('svg[aria-hidden="true"] text')).toBeNull()
    expect(container.querySelector('[data-graph-mutation-control]')).toBeNull()

    const runButton = screen.getByRole('button', { name: 'Run' })
    fireEvent.click(screen.getByRole('button', { name: 'Configure workflow' }))
    expect(onConfigure).toHaveBeenCalledOnce()
    expect(runButton.getAttribute('aria-keyshortcuts')).toBe('R')
    fireEvent.keyDown(window, { key: 'r' })
    expect(onRun).toHaveBeenCalledTimes(1)
    const agentName = screen.getByRole('textbox', { name: 'Agent name' })
    agentName.focus()
    fireEvent.keyDown(agentName, { key: 'r' })
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('keeps disabled action reasons accessible without rendering an inline status', () => {
    render(
      <WorkflowCanvas
        workflow={workflow}
        onNodeSelect={vi.fn()}
        onRun={vi.fn()}
        runDisabledReason="Pi is unavailable. Open Harnesses before running."
      />,
    )

    expect(screen.queryByRole('status', { name: 'Workflow actions unavailable' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Run' }).getAttribute('aria-description')).toBe(
      'Pi is unavailable. Open Harnesses before running.',
    )
  })

  it('keeps the Run action icon-only without resize motion', () => {
    render(<WorkflowCanvas workflow={workflow} onNodeSelect={vi.fn()} onRun={vi.fn()} runnable />)

    const runButton = screen.getByRole('button', { name: 'Run' })
    expect(runButton.querySelector('svg')).toBeTruthy()
    expect(runButton.textContent).toBe('')
    expect(runButton.className).not.toContain('t-resize')
    expect(runButton.className).not.toContain('w-max')
  })

  it('directs empty workflows to the JSON configuration without offering node creation', () => {
    render(
      <WorkflowCanvas
        workflow={{ ...workflow, startNodeId: null, nodes: [], edges: [] } as Workflow}
        onNodeSelect={vi.fn()}
        onConfigure={vi.fn()}
        onRun={vi.fn()}
      />,
    )

    expect(screen.getByText('No agents')).toBeTruthy()
    expect(screen.getByText(/Define the graph JSON in workflow configuration/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Add/ })).toBeNull()
  })
})
