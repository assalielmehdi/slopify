// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkflowFileSchema } from '@slopify/workflow-model'

import {
  WorkflowGraphJsonEditor,
  formatWorkflowGraphSource,
  parseWorkflowGraphSource,
} from '../components/workflow/workflow-graph-json-editor'

const workflow = WorkflowFileSchema.parse({
  schemaVersion: 2,
  workflowId: 'release-review',
  name: 'Release review',
  description: 'Prepare and review a release.',
  repositories: { repositoryIds: [], primaryRepositoryId: null },
  variables: [],
  graph: { startNodeId: null, nodes: [], edges: [], maxTransitions: 100 },
  createdAt: '2026-08-25T10:00:00.000Z',
  updatedAt: '2026-08-25T10:00:00.000Z',
})

afterEach(cleanup)

describe('WorkflowGraphJsonEditor', () => {
  it('reports syntax and schema diagnostics without losing the edited source', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <WorkflowGraphJsonEditor source="{" workflow={workflow} onChange={onChange} />,
    )

    expect(
      (screen.getByRole('textbox', { name: 'Workflow graph JSON' }) as HTMLTextAreaElement).value,
    ).toBe('{')
    expect(screen.getByRole('alert').textContent).toContain('Graph definition is not valid JSON')
    expect(
      (screen.getByRole('button', { name: 'Format JSON' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    const invalidSchema = JSON.stringify({ ...workflow.graph, nodes: 'invalid' })
    rerender(
      <WorkflowGraphJsonEditor source={invalidSchema} workflow={workflow} onChange={onChange} />,
    )
    expect(screen.getByRole('alert').textContent).toContain('nodes')
    expect(
      (screen.getByRole('textbox', { name: 'Workflow graph JSON' }) as HTMLTextAreaElement).value,
    ).toBe(invalidSchema)
  })

  it('reports semantic graph diagnostics and accepts an empty draft', () => {
    const invalid = JSON.stringify({
      ...workflow.graph,
      startNodeId: null,
      nodes: [
        {
          type: 'agent',
          id: 'prepare',
          name: 'Prepare',
          prompt: 'Prepare the release.',
          harness: { harnessId: 'pi' },
        },
      ],
    })

    expect(parseWorkflowGraphSource(invalid, workflow)).toMatchObject({
      status: 'INVALID',
      diagnostics: [expect.objectContaining({ path: ['startNodeId'] })],
    })
    expect(parseWorkflowGraphSource(formatWorkflowGraphSource(workflow.graph), workflow)).toEqual({
      status: 'VALID',
      value: workflow.graph,
      diagnostics: [],
    })
  })

  it('formats valid JSON through the controlled source callback', () => {
    const onChange = vi.fn()
    const compact = JSON.stringify(workflow.graph)
    render(<WorkflowGraphJsonEditor source={compact} workflow={workflow} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Format JSON' }))

    expect(onChange).toHaveBeenCalledWith(formatWorkflowGraphSource(workflow.graph))
  })
})
