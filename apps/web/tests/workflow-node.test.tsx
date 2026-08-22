// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createPredefinedV1Workflow } from '@slopify/workflow-model'

import { WorkflowNodeContent } from '../components/workflow/workflow-node'

const workflow = createPredefinedV1Workflow({
  createdAt: '2026-08-18T12:00:00Z',
  agentDefaults: {
    provider: 'test-provider',
    model: 'test-model',
    thinkingLevel: 'high',
  },
})

afterEach(cleanup)

describe('WorkflowNode', () => {
  it('uses text and icons to identify kind, start, selection, and recent status', () => {
    const node = workflow.nodes.find(({ id }) => id === 'identify-agent')
    if (node === undefined || node.type !== 'agent') throw new Error('Expected agent node')

    render(
      <WorkflowNodeContent
        data={{
          domainNode: node,
          isStart: true,
          recentRunStatus: 'RUNNING',
        }}
        selected
      />,
    )

    expect(screen.getByText('Agent')).toBeTruthy()
    expect(screen.getByText('Start')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('Selected')).toBeTruthy()
    expect(screen.getByText('Who are you?')).toBeTruthy()
  })

  it.each([
    ['SUCCEEDED', 'border-status-success', 'bg-status-success'],
    ['FAILED', 'border-destructive', 'bg-destructive'],
    ['RUNNING', 'border-status-info', 'bg-status-info'],
  ] as const)(
    'uses a semantic whole-card treatment for %s nodes',
    (status, borderClass, backgroundClass) => {
      const node = workflow.nodes.find(({ id }) => id === 'identify-agent')
      if (node === undefined || node.type !== 'agent') throw new Error('Expected agent node')

      const { container } = render(
        <WorkflowNodeContent
          data={{
            domainNode: node,
            isStart: false,
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
})
