// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createDeliveryWorkflowTestRevision } from '../../../packages/execution-runtime/tests/fixtures/delivery-workflow'

import { WorkflowNodeContent } from '../components/workflow/workflow-node'

const revision = createDeliveryWorkflowTestRevision({
  revisionId: 'revision-01',
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
    const node = revision.nodes.find(({ id }) => id === 'select-repositories')
    if (node === undefined) throw new Error('Expected repository-selection node')

    render(
      <WorkflowNodeContent
        data={{
          domainNode: node,
          isStart: true,
          isTerminal: false,
          recentRunStatus: 'RUNNING',
        }}
        selected
      />,
    )

    expect(screen.getByText('Agent')).toBeTruthy()
    expect(screen.getByText('Start')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText('Selected')).toBeTruthy()
    expect(screen.getByText('Select affected repositories')).toBeTruthy()
  })

  it('identifies terminal outcome with a non-color cue', () => {
    const node = revision.nodes.find(({ id }) => id === 'failed')
    if (node === undefined) throw new Error('Expected failed terminal node')

    render(
      <WorkflowNodeContent
        data={{ domainNode: node, isStart: false, isTerminal: true }}
        selected={false}
      />,
    )

    expect(screen.getByText('Terminal')).toBeTruthy()
    expect(screen.getAllByText('Failed')).toHaveLength(2)
  })
})
