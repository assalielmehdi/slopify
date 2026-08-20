// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createDeliveryWorkflowTestRevision } from '../../../packages/execution-runtime/tests/fixtures/delivery-workflow'

import { NodeInspector } from '../components/workflow/node-inspector'

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

describe('NodeInspector', () => {
  it('shows common metadata, graph relationships, and read-only agent configuration', () => {
    const node = revision.nodes.find(({ id }) => id === 'implement')
    if (node === undefined) throw new Error('Expected implementation node')

    render(
      <NodeInspector
        node={node}
        revisionId={revision.revisionId}
        isStart={false}
        outgoingEdges={revision.edges.filter(({ sourceNodeId }) => sourceNodeId === node.id)}
        recentRun={{ status: 'SUCCEEDED', durationMs: 12_345 }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Implement' })).toBeTruthy()
    expect(screen.getByText('revision-01')).toBeTruthy()
    expect(screen.getByText('Pi SDK')).toBeTruthy()
    expect(screen.getByText('0.84.2')).toBeTruthy()
    expect(screen.getByText('test-provider-default / test-model')).toBeTruthy()
    expect(screen.getByText('All run worktrees, read/write')).toBeTruthy()
    expect(screen.getByText('No skills selected')).toBeTruthy()
    expect(screen.getByText('workflow-output/implementation-summary-v1')).toBeTruthy()
    expect(screen.getByText('12.3 s')).toBeTruthy()

    const outgoing = screen.getByRole('list', { name: 'Outgoing edges' })
    expect(within(outgoing).getByText('implemented')).toBeTruthy()
    expect(within(outgoing).getByText('blocked')).toBeTruthy()
  })

  it('shows deterministic entrypoint and source policy without editable controls', () => {
    const node = revision.nodes.find(({ id }) => id === 'verify')
    if (node === undefined) throw new Error('Expected verification node')

    render(
      <NodeInspector
        node={node}
        revisionId={revision.revisionId}
        isStart={false}
        outgoingEdges={revision.edges.filter(({ sourceNodeId }) => sourceNodeId === node.id)}
      />,
    )

    expect(screen.getByText('verify-selected-repositories')).toBeTruthy()
    expect(screen.getByText('Server-bounded arguments')).toBeTruthy()
    expect(screen.getByText('Available from pinned run evidence')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
