// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    Handle: ({ type }: { type: string }) => <span data-testid={`${type}-handle`} />,
  }
})

import { WorkflowNode, WorkflowNodeContent } from '../components/workflow/workflow-node'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const workflow = createAgentWorkflowFixture({
  createdAt: '2026-08-18T12:00:00Z',
  modelId: 'test-model',
  thinkingLevel: 'high',
})

afterEach(cleanup)

describe('WorkflowNode', () => {
  it('uses text and icons to identify kind, start, selection, and recent status', () => {
    const node = workflow.nodes.find(({ id }) => id === 'identify-agent')
    if (node === undefined) throw new Error('Expected agent node')

    render(
      <WorkflowNodeContent
        data={{
          domainNode: node,
          isStart: true,
          isEnd: true,
          recentRunStatus: 'RUNNING',
        }}
        selected
      />,
    )

    expect(screen.getByText('Agent')).toBeTruthy()
    expect(screen.getByText('Start')).toBeTruthy()
    expect(screen.getByText('End')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('Selected')).toBeTruthy()
    expect(screen.getByText('Who are you?')).toBeTruthy()
  })

  it.each([
    ['SUCCEEDED', 'border-status-success', 'bg-status-success'],
    ['FAILED', 'border-destructive', 'bg-destructive'],
    ['RUNNING', 'border-status-info', 'workflow-node-running-fill'],
  ] as const)(
    'uses a semantic whole-card treatment for %s nodes',
    (status, borderClass, backgroundClass) => {
      const node = workflow.nodes.find(({ id }) => id === 'identify-agent')
      if (node === undefined) throw new Error('Expected agent node')

      const { container } = render(
        <WorkflowNodeContent
          data={{
            domainNode: node,
            isStart: false,
            isEnd: true,
            recentRunStatus: status,
          }}
          selected={false}
        />,
      )

      const card = container.querySelector('article')
      expect(card?.getAttribute('data-status')).toBe(status)
      expect(card?.className).toContain(borderClass)
      expect(card?.className).toContain(backgroundClass)
    },
  )

  it('animates the background fill only while the agent is running', () => {
    const node = workflow.nodes.find(({ id }) => id === 'identify-agent')
    if (node === undefined) throw new Error('Expected agent node')

    const view = render(
      <WorkflowNodeContent
        data={{
          domainNode: node,
          isStart: false,
          isEnd: true,
          recentRunStatus: 'RUNNING',
        }}
        selected={false}
      />,
    )

    expect(view.container.querySelector('article')?.className).toContain(
      'workflow-node-running-fill',
    )

    view.rerender(
      <WorkflowNodeContent
        data={{
          domainNode: node,
          isStart: false,
          isEnd: true,
          recentRunStatus: 'SUCCEEDED',
        }}
        selected={false}
      />,
    )

    expect(view.container.querySelector('article')?.className).not.toContain(
      'workflow-node-running-fill',
    )
  })

  it('hides the incoming handle on start and keeps every agent connectable onward', () => {
    const node = workflow.nodes.find(({ id }) => id === 'identify-agent')
    if (node === undefined) throw new Error('Expected agent node')

    const startProps = {
      data: { domainNode: node, isStart: true, isEnd: false },
      selected: false,
      isConnectable: true,
    } as unknown as Parameters<typeof WorkflowNode>[0]
    const view = render(<WorkflowNode {...startProps} />)

    expect(screen.queryByTestId('target-handle')).toBeNull()
    expect(screen.getByTestId('source-handle')).toBeTruthy()

    const endProps = {
      data: { domainNode: node, isStart: false, isEnd: true },
      selected: false,
      isConnectable: true,
    } as unknown as Parameters<typeof WorkflowNode>[0]
    view.rerender(<WorkflowNode {...endProps} />)
    expect(screen.getByTestId('target-handle')).toBeTruthy()
    expect(screen.getByTestId('source-handle')).toBeTruthy()
  })

  it('describes why adding after an agent is unavailable', () => {
    const node = workflow.nodes.find(({ id }) => id === 'identify-agent')
    if (node === undefined) throw new Error('Expected agent node')
    const props = {
      data: {
        domainNode: node,
        isStart: true,
        isEnd: true,
        onAddAgent: vi.fn(),
        addAgentDisabledReason: 'Pi is unavailable.',
      },
      selected: true,
      isConnectable: true,
    } as unknown as Parameters<typeof WorkflowNode>[0]

    render(<WorkflowNode {...props} />)

    const add = screen.getByRole('button', { name: 'Add agent after Who are you?' })
    expect(add.getAttribute('aria-describedby')).toBe('workflow-action-status')
  })
})
