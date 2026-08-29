// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AgentNodeSchema } from '@slopify/shared'

import { WorkflowNodeContent } from '../components/workflow/workflow-node'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const workflow = createAgentWorkflowFixture({
  createdAt: '2026-08-18T12:00:00Z',
  modelId: 'test-model',
  thinkingLevel: 'high',
})

afterEach(cleanup)

describe('WorkflowNode', () => {
  it('shows harness, model, and thinking metadata in that order at the bottom right', () => {
    const node = workflow.nodes.find(({ id }) => id === 'identify-agent')
    if (node === undefined) throw new Error('Expected agent node')

    const { container } = render(
      <WorkflowNodeContent
        data={{ domainNode: node, isStart: true, isEnd: false }}
        selected={false}
      />,
    )

    const metadata = container.querySelector('[data-node-runtime]')
    expect(metadata?.className).toContain('mt-auto')
    expect(metadata?.className).toContain('justify-end')

    const [harness, model, thinking] = Array.from(metadata?.children ?? [])
    expect(harness?.getAttribute('data-runtime-field')).toBe('harness')
    expect(harness?.querySelector('img')?.getAttribute('src')).toContain('/pi-badge.svg')
    expect(model?.getAttribute('data-runtime-field')).toBe('model')
    expect(model?.getAttribute('aria-label')).toBe('Model: test-model')
    expect(model?.textContent).toBe('test-model')
    expect(thinking?.getAttribute('data-runtime-field')).toBe('thinking')
    expect(thinking?.getAttribute('aria-label')).toBe('Thinking effort: high')
    expect(thinking?.textContent).toBe('high')
  })

  it('uses the Codex logo and labels inherited runtime defaults explicitly', () => {
    const originalNode = workflow.nodes.find(({ id }) => id === 'identify-agent')
    if (originalNode === undefined) throw new Error('Expected agent node')
    const node = AgentNodeSchema.parse({
      ...originalNode,
      harness: { harnessId: 'codex' },
    })

    const { container } = render(
      <WorkflowNodeContent
        data={{ domainNode: node, isStart: true, isEnd: false }}
        selected={false}
      />,
    )

    const metadata = container.querySelector('[data-node-runtime]')
    expect(metadata?.querySelector('img')?.getAttribute('src')).toContain('/codex-logo.svg')
    expect(screen.getByText('Default model')).toBeTruthy()
    expect(screen.getByText('Default effort')).toBeTruthy()
  })

  it('uses the configured repository-card surface in workflow and run graphs', () => {
    const node = workflow.nodes.find(({ id }) => id === 'identify-agent')
    if (node === undefined) throw new Error('Expected agent node')

    const view = render(
      <WorkflowNodeContent
        data={{ domainNode: node, isStart: true, isEnd: false }}
        selected={false}
      />,
    )

    const card = view.container.firstElementChild
    expect(card?.className).toContain('bg-muted/55')
    expect(card?.className).not.toContain('bg-card')

    view.rerender(
      <WorkflowNodeContent
        data={{
          domainNode: node,
          isStart: true,
          isEnd: false,
          recentRunStatus: 'RUNNING',
        }}
        selected={false}
      />,
    )

    expect(view.container.firstElementChild?.className).toContain('bg-muted/55')
  })

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

  it('uses the semantic success surface for succeeded nodes', () => {
    const node = workflow.nodes.find(({ id }) => id === 'identify-agent')
    if (node === undefined) throw new Error('Expected agent node')

    const { container } = render(
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

    const card = container.querySelector('[data-status]')
    expect(card?.className).toContain('border-status-success/35')
    expect(card?.className).toContain('bg-status-success/10')
    expect(card?.className).not.toContain('bg-muted/55')
  })

  it.each([
    ['FAILED', 'border-destructive', 'bg-destructive'],
    ['CANCELLED', 'border-status-warning', 'bg-status-warning'],
  ] as const)(
    'keeps the shared card surface and uses a semantic border for %s nodes',
    (status, borderClass, replacedBackgroundClass) => {
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

      const card = container.querySelector('[data-status]')
      expect(card?.getAttribute('data-status')).toBe(status)
      expect(card?.className).toContain(borderClass)
      expect(card?.className).toContain('bg-muted/55')
      expect(card?.className).not.toContain(replacedBackgroundClass)
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

    expect(view.container.querySelector('[data-status]')?.className).toContain(
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

    expect(view.container.querySelector('[data-status]')?.className).not.toContain(
      'workflow-node-running-fill',
    )
  })
})
