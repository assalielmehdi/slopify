// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDeliveryWorkflowTestRevision,
  deriveDeliveryWorkflowTestRevision,
} from '../../../packages/execution-runtime/tests/fixtures/delivery-workflow'

import { WorkflowWorkbench } from '../components/workflow/workflow-workbench'
import { createApiClient } from '../lib/api-client'

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

const savedRevision = deriveDeliveryWorkflowTestRevision(latestRevision, {
  revisionId: 'revision-03',
  createdAt: '2026-08-20T12:00:00Z',
  updates: [{ nodeId: 'implement', changes: { modelId: 'implementation-model-v2' } }],
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

describe('workflow revision saving', () => {
  it('posts the explicit immutable-revision contract and validates the response', async () => {
    const fetchImplementation = vi.fn(async () => Response.json(savedRevision, { status: 201 }))
    const client = createApiClient({ fetch: fetchImplementation })
    const input = {
      parentRevisionId: 'revision-02',
      revisionId: 'revision-03',
      updates: [{ nodeId: 'implement', changes: { modelId: 'implementation-model-v2' } }],
    } as const

    await expect(client.createWorkflowRevision('delivery-workflow', input)).resolves.toEqual(
      savedRevision,
    )
    expect(fetchImplementation).toHaveBeenCalledWith('/api/workflows/delivery-workflow/revisions', {
      body: JSON.stringify(input),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    })
  })

  it('selects the server-confirmed revision only after save and preserves the source revision', async () => {
    let confirmSave: ((revision: typeof savedRevision) => void) | undefined
    const pendingSave = new Promise<typeof savedRevision>((resolve) => {
      confirmSave = resolve
    })
    const client = {
      listWorkflows: vi.fn(async () => catalog),
      getWorkflowRevision: vi.fn(async (_workflowId: string, revisionId: string) => {
        if (revisionId === savedRevision.revisionId) return savedRevision
        if (revisionId === firstRevision.revisionId) return firstRevision
        return latestRevision
      }),
      createWorkflowRevision: vi.fn(async () => pendingSave),
    }

    render(<WorkflowWorkbench client={client} createRevisionId={() => savedRevision.revisionId} />)

    expect(await screen.findByText('Graph revision-02')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Implement' }))
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'implementation-model-v2' },
    })
    fireEvent.submit(screen.getByRole('form', { name: 'Agent configuration' }))

    expect(client.createWorkflowRevision).toHaveBeenCalledWith('delivery-workflow', {
      parentRevisionId: 'revision-02',
      revisionId: 'revision-03',
      updates: [{ nodeId: 'implement', changes: { modelId: 'implementation-model-v2' } }],
    })
    expect(screen.getByText('Graph revision-02')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Publishing revision' }).hasAttribute('disabled'),
    ).toBe(true)

    confirmSave?.(savedRevision)
    expect(await screen.findByText('Graph revision-03')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Implement' })).toBeTruthy()

    const selector = screen.getByRole('combobox', { name: 'Workflow revision' })
    fireEvent.click(selector)
    const oldRevision = await screen.findByRole('option', { name: /revision-02/ })
    fireEvent.pointerDown(oldRevision, { pointerType: 'mouse' })
    fireEvent.click(oldRevision)

    await waitFor(() => expect(screen.getByText('Graph revision-02')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Implement' }))
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('test-model')
    expect(client.getWorkflowRevision).toHaveBeenLastCalledWith('delivery-workflow', 'revision-02')
  })
})
