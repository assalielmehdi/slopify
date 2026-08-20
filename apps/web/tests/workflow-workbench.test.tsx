// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDeliveryWorkflowTestRevision,
  deriveDeliveryWorkflowTestRevision,
} from '../../../packages/execution-runtime/tests/fixtures/delivery-workflow'

import { WorkflowWorkbench } from '../components/workflow/workflow-workbench'

vi.mock('../components/workflow/workflow-canvas', () => ({
  WorkflowCanvas: ({
    revision,
    onNodeSelect,
  }: {
    revision: { revisionId: string }
    onNodeSelect: (nodeId: string) => void
  }) => (
    <div aria-label="Workflow graph">
      <p>Graph {revision.revisionId}</p>
      <button type="button" onClick={() => onNodeSelect('implement')}>
        Inspect Implement
      </button>
    </div>
  ),
}))

const firstRevision = createDeliveryWorkflowTestRevision({
  revisionId: 'revision-01',
  createdAt: '2026-08-18T12:00:00Z',
  agentDefaults: {
    provider: 'test-provider',
    model: 'test-model',
    thinkingLevel: 'high',
  },
})

const latestRevision = deriveDeliveryWorkflowTestRevision(firstRevision, {
  revisionId: 'revision-02',
  createdAt: '2026-08-19T12:00:00Z',
  updates: [{ nodeId: 'plan', changes: { modelId: 'test-model-v2' } }],
})

const catalog = [
  {
    workflowId: latestRevision.workflowId,
    name: latestRevision.name,
    latestRevisionId: latestRevision.revisionId,
    revisions: [
      {
        revisionId: latestRevision.revisionId,
        parentRevisionId: latestRevision.parentRevisionId ?? null,
        createdAt: latestRevision.createdAt,
      },
      {
        revisionId: firstRevision.revisionId,
        parentRevisionId: null,
        createdAt: firstRevision.createdAt,
      },
    ],
  },
] as const

afterEach(cleanup)

describe('WorkflowWorkbench', () => {
  it('loads the latest revision and keeps graph selection in the inspector', async () => {
    const client = {
      listWorkflows: vi.fn(async () => catalog),
      getWorkflowRevision: vi.fn(async () => latestRevision),
      createWorkflowRevision: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    expect(await screen.findByText('Graph revision-02')).toBeTruthy()
    expect(client.getWorkflowRevision).toHaveBeenCalledWith('delivery-workflow', 'revision-02')
    expect(screen.getByRole('heading', { name: 'Load ClickUp task' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Inspect Implement' }))

    expect(screen.getByRole('heading', { name: 'Implement' })).toBeTruthy()
  })

  it('loads another immutable revision from the accessible selector', async () => {
    const client = {
      listWorkflows: vi.fn(async () => catalog),
      getWorkflowRevision: vi.fn(async (_workflowId: string, revisionId: string) =>
        revisionId === 'revision-01' ? firstRevision : latestRevision,
      ),
      createWorkflowRevision: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    const selector = await screen.findByRole('combobox', { name: 'Workflow revision' })
    fireEvent.click(selector)
    const option = await screen.findByRole('option', { name: /revision-01/ })
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option)

    await waitFor(() => {
      expect(screen.getByText('Graph revision-01')).toBeTruthy()
    })
    expect(client.getWorkflowRevision).toHaveBeenLastCalledWith('delivery-workflow', 'revision-01')
  })

  it('shows a structured error state when no workflow is available', async () => {
    const client = {
      listWorkflows: vi.fn(async () => []),
      getWorkflowRevision: vi.fn(),
      createWorkflowRevision: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    expect((await screen.findByRole('alert')).textContent).toContain(
      'No workflow revisions available',
    )
  })
})
