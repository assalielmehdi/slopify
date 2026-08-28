// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { WorkflowWorkspace } from '../components/workflow/workflow-workspace'
import { workflowGraphPaneWidth } from '../lib/workflow-graph-layout'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const workflow = createAgentWorkflowFixture({
  createdAt: '2026-08-18T12:00:00Z',
  modelId: 'test-model',
  thinkingLevel: 'high',
})

afterEach(cleanup)

describe('WorkflowWorkspace', () => {
  it('keeps graph and details in persistent adaptive panes', () => {
    render(
      <WorkflowWorkspace
        details={<p>Persistent details</p>}
        graph={<p>Adaptive graph</p>}
        workflow={workflow}
      />,
    )

    const workspace = screen.getByTestId('workflow-workspace')
    expect(workspace.getAttribute('data-layout')).toBe('adaptive-split')
    expect(workspace.getAttribute('style')).toContain(
      `--workflow-graph-pane-width: ${workflowGraphPaneWidth(workflow)}px`,
    )
    expect(screen.getByRole('region', { name: 'Workflow graph pane' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Workflow details pane' })).toBeTruthy()
  })
})
