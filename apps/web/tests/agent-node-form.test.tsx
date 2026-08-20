// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPredefinedV1Revision } from '@loop/workflow-model'

import { AgentNodeForm } from '../components/workflow/agent-node-form'
import { ApiClientError } from '../lib/api-client'

const revision = createPredefinedV1Revision({
  revisionId: 'revision-01',
  createdAt: '2026-08-18T12:00:00Z',
  agentDefaults: {
    provider: 'test-provider',
    model: 'test-model',
    thinkingLevel: 'high',
  },
})

const agentNode = revision.nodes.find((node) => node.id === 'plan' && node.type === 'agent')
if (agentNode === undefined || agentNode.type !== 'agent') {
  throw new Error('Expected planning agent')
}

afterEach(cleanup)

describe('AgentNodeForm', () => {
  it('submits only the nine editable agent configuration fields', async () => {
    const onSave = vi.fn(async () => undefined)

    render(<AgentNodeForm node={agentNode} onSave={onSave} />)

    const form = screen.getByRole('form', { name: 'Agent configuration' })
    expect(
      [
        ...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          '[name]',
        ),
      ]
        .map(({ name }) => name)
        .sort(),
    ).toEqual(
      [
        'model',
        'outputSchemaRef',
        'permissionProfile',
        'promptTemplate',
        'provider',
        'resourceBundleId',
        'thinkingLevel',
        'timeoutSeconds',
        'workspacePolicy',
      ].sort(),
    )

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'provider-v2' } })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'model-v2' } })
    fireEvent.change(screen.getByLabelText('Thinking level'), { target: { value: 'medium' } })
    fireEvent.change(screen.getByLabelText('Prompt template'), {
      target: { value: 'Create a revised execution plan.' },
    })
    fireEvent.change(screen.getByLabelText('Workspace policy'), {
      target: { value: 'candidate-repositories' },
    })
    fireEvent.change(screen.getByLabelText('Permission profile'), {
      target: { value: 'workspace-write' },
    })
    fireEvent.change(screen.getByLabelText('Resource bundle'), {
      target: { value: 'planning.v2' },
    })
    fireEvent.change(screen.getByLabelText('Output schema'), {
      target: { value: 'workflow-output/plan-v2' },
    })
    fireEvent.change(screen.getByLabelText('Timeout (seconds)'), { target: { value: '900' } })
    fireEvent.submit(form)

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        provider: 'provider-v2',
        model: 'model-v2',
        thinkingLevel: 'medium',
        promptTemplate: 'Create a revised execution plan.',
        workspacePolicy: 'candidate-repositories',
        permissionProfile: 'workspace-write',
        resourceBundleId: 'planning.v2',
        outputSchemaRef: 'workflow-output/plan-v2',
        timeoutSeconds: 900,
      })
    })
  })

  it('associates local validation failures with their controls and does not save', async () => {
    const onSave = vi.fn(async () => undefined)

    render(<AgentNodeForm node={agentNode} onSave={onSave} />)

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Timeout (seconds)'), { target: { value: '0' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Agent configuration' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Provider').getAttribute('aria-invalid')).toBe('true')
      expect(screen.getByLabelText('Timeout (seconds)').getAttribute('aria-invalid')).toBe('true')
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('associates a structured server error path with the rejected field', async () => {
    const onSave = vi.fn(async () => {
      throw new ApiClientError({
        code: 'REVISION_INVALID',
        message: 'Workflow revision is invalid',
        status: 422,
        details: { path: ['nodes', 2, 'permissionProfile'] },
      })
    })

    render(<AgentNodeForm node={agentNode} onSave={onSave} />)

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'model-v2' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Agent configuration' }))

    const permissions = await screen.findByLabelText('Permission profile')
    await waitFor(() => expect(permissions.getAttribute('aria-invalid')).toBe('true'))
    const field = permissions.closest<HTMLElement>('[data-slot="field"]')
    if (field === null) throw new Error('Expected permission field')
    expect(within(field).getByRole('alert').textContent).toBe('Workflow revision is invalid')
  })
})
