// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPredefinedV1Workflow, type Workflow } from '@slopify/workflow-model'

import { WorkflowWorkbench } from '../components/workflow/workflow-workbench'

vi.mock('../components/workflow/workflow-canvas', () => ({
  WorkflowCanvas: ({ workflow }: { workflow: { name: string } }) => (
    <div aria-label="Workflow graph">Graph {workflow.name}</div>
  ),
}))

const workflow = createPredefinedV1Workflow({
  createdAt: '2026-08-18T12:00:00Z',
  agentDefaults: {
    provider: 'test-provider',
    model: 'test-model',
    thinkingLevel: 'high',
  },
})
const catalog = [workflow] as const

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('WorkflowWorkbench', () => {
  it('loads the current workflow without version or editing controls', async () => {
    const client = {
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn(async () => workflow),
    }

    render(<WorkflowWorkbench client={client} />)

    expect(await screen.findByText(`Graph ${workflow.name}`)).toBeTruthy()
    expect(client.getWorkflow).toHaveBeenCalledWith('delivery-workflow')
    expect(screen.getByRole('link', { name: 'New run' }).getAttribute('href')).toBe('/runs/new')
    expect(screen.queryByText(/version/i)).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Selected node details' })).toBeNull()
  })

  it('shows a structured error state when no workflow is available', async () => {
    const client = {
      listWorkflows: vi.fn(async () => []),
      getWorkflow: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    expect((await screen.findByRole('alert')).textContent).toContain('No workflows available')
  })

  it('renders a zero-node workflow as an empty non-runnable canvas', async () => {
    const emptyWorkflow = {
      ...workflow,
      startNodeId: null,
      nodes: [],
      edges: [],
    } as unknown as Workflow
    const client = {
      listWorkflows: vi.fn(async () => [emptyWorkflow]),
      getWorkflow: vi.fn(async () => emptyWorkflow),
    }

    render(<WorkflowWorkbench client={client} />)

    expect(await screen.findByText(`Graph ${workflow.name}`)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'New run' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.queryByRole('link', { name: 'New run' })).toBeNull()
  })
})
