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

const skills = [
  {
    skillId: 'planning',
    name: 'planning',
    description: 'Plan delivery work.',
    digest: 'a'.repeat(64),
    modifiedAt: '2026-08-20T00:00:00.000Z',
    valid: true,
    issues: [],
    files: [{ path: 'SKILL.md', content: 'instructions', size: 12 }],
  },
] as const
const connections = [
  {
    connectionId: 'openrouter-v2',
    type: 'openrouter',
    category: 'inference',
    label: 'OpenRouter',
    authority: 'Inference',
    configuration: {},
    metadata: {},
    status: 'CONNECTED',
    validatedAt: '2026-08-20T00:00:00.000Z',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  },
  {
    connectionId: 'gitlab-primary',
    type: 'gitlab',
    category: 'connector',
    label: 'GitLab',
    authority: 'GitLab access',
    configuration: {},
    metadata: {},
    status: 'CONNECTED',
    validatedAt: '2026-08-20T00:00:00.000Z',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  },
  {
    connectionId: 'clickup-primary',
    type: 'clickup',
    category: 'connector',
    label: 'ClickUp',
    authority: 'ClickUp access',
    configuration: {},
    metadata: {},
    status: 'CONNECTED',
    validatedAt: '2026-08-20T00:00:00.000Z',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  },
] as const

describe('AgentNodeForm', () => {
  it('submits only agent-job and execution-policy fields', async () => {
    const onSave = vi.fn(async () => undefined)

    render(
      <AgentNodeForm node={agentNode} skills={skills} connections={connections} onSave={onSave} />,
    )

    const form = screen.getByRole('form', { name: 'Agent configuration' })
    expect(
      [
        ...new Set(
          [
            ...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
              '[name]',
            ),
          ].map(({ name }) => name),
        ),
      ].sort(),
    ).toEqual(
      [
        'connectionId',
        'connectorIds',
        'modelId',
        'name',
        'outputSchemaRef',
        'prompt',
        'skillIds',
        'thinkingLevel',
        'timeoutSeconds',
      ].sort(),
    )

    fireEvent.change(screen.getByLabelText('Inference connection'), {
      target: { value: 'openrouter-v2' },
    })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'model-v2' } })
    fireEvent.change(screen.getByLabelText('Thinking level'), { target: { value: 'medium' } })
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Create a revised execution plan.' },
    })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Revised plan' } })
    fireEvent.click(screen.getByLabelText(/planning/))
    fireEvent.click(screen.getByLabelText(/GitLab/))
    fireEvent.click(screen.getByLabelText(/ClickUp/))
    fireEvent.change(screen.getByLabelText('Result schema'), {
      target: { value: 'workflow-output/plan-v2' },
    })
    fireEvent.change(screen.getByLabelText('Timeout (seconds)'), { target: { value: '900' } })
    fireEvent.submit(form)

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        name: 'Revised plan',
        connectionId: 'openrouter-v2',
        modelId: 'model-v2',
        thinkingLevel: 'medium',
        prompt: 'Create a revised execution plan.',
        connectorIds: ['gitlab-primary', 'clickup-primary'],
        skillIds: ['planning'],
        outputSchemaRef: 'workflow-output/plan-v2',
        timeoutSeconds: 900,
      })
    })
  })

  it('associates local validation failures with their controls and does not save', async () => {
    const onSave = vi.fn(async () => undefined)

    render(<AgentNodeForm node={agentNode} onSave={onSave} />)

    fireEvent.change(screen.getByLabelText('Inference connection'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Timeout (seconds)'), { target: { value: '0' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Agent configuration' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Inference connection').getAttribute('aria-invalid')).toBe(
        'true',
      )
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
        details: { path: ['nodes', 2, 'job', 'connectorIds'] },
      })
    })

    render(<AgentNodeForm node={agentNode} onSave={onSave} />)

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'model-v2' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Agent configuration' }))

    const connectors = await screen.findByRole('group', { name: 'Connector grants' })
    await waitFor(() => expect(connectors.getAttribute('aria-invalid')).toBe('true'))
    const field = connectors.closest<HTMLElement>('[data-slot="field"]')
    if (field === null) throw new Error('Expected connector field')
    expect(within(field).getByRole('alert').textContent).toBe('Workflow revision is invalid')
  })
})
