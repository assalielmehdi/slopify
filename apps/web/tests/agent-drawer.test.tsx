// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentNodeSchema, createPredefinedV1Workflow } from '@slopify/workflow-model'
import type { ConnectionCatalogEntry } from '@slopify/contracts'

import { AgentDrawer, createAgentId } from '../components/workflow/agent-drawer'
import { toast } from '../components/ui/toast'
import type { ConnectionRecord, SkillRecord } from '../lib/api-client'

const workflow = createPredefinedV1Workflow({
  createdAt: '2026-08-18T12:00:00Z',
  agentDefaults: {
    provider: 'chatgpt-subscription',
    model: 'gpt-5.4',
    thinkingLevel: 'medium',
  },
})

const existingAgent = workflow.nodes[0]
if (existingAgent?.type !== 'agent') throw new Error('Expected an agent fixture')

const connection = (
  input: Partial<ConnectionRecord> &
    Pick<ConnectionRecord, 'connectionId' | 'type' | 'category' | 'label'>,
): ConnectionRecord => ({
  authority: 'Test authority',
  configuration: {},
  metadata: {},
  status: 'CONNECTED',
  validatedAt: '2026-08-22T08:00:00Z',
  createdAt: '2026-08-22T08:00:00Z',
  updatedAt: '2026-08-22T08:00:00Z',
  ...input,
})

const connections = [
  connection({
    connectionId: 'chatgpt-subscription-default',
    type: 'chatgpt-subscription',
    category: 'inference',
    label: 'ChatGPT',
  }),
  connection({
    connectionId: 'gitlab-primary',
    type: 'gitlab',
    category: 'connector',
    label: 'GitLab',
  }),
] as const

const catalog = [
  {
    type: 'chatgpt-subscription',
    category: 'inference',
    name: 'ChatGPT',
    icon: 'chatgpt',
    eyebrow: 'Subscription provider',
    summary: 'Use a ChatGPT subscription.',
    description: 'Use ChatGPT through Pi.',
    setup: ['Connect ChatGPT.'],
    access: 'Inference only.',
    models: [
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      },
      {
        id: 'gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
    ],
  },
] as const satisfies readonly ConnectionCatalogEntry[]

const skills = [
  {
    skillId: 'research',
    name: 'Research',
    description: 'Find and synthesize evidence.',
    digest: 'a'.repeat(64),
    modifiedAt: '2026-08-22T08:00:00Z',
    valid: true,
    issues: [],
    files: [],
    kind: 'user',
  },
] as const satisfies readonly SkillRecord[]

afterEach(cleanup)

describe('AgentDrawer', () => {
  it('does not offer built-in connector skills as explicit agent choices', () => {
    render(
      <AgentDrawer
        mode={{ kind: 'create' }}
        existingNodeIds={new Set([existingAgent.id])}
        catalog={catalog}
        connections={connections}
        skills={[
          ...skills,
          {
            ...skills[0],
            skillId: 'gitlab-connector',
            name: 'GitLab connector',
            kind: 'connector',
            readOnly: true,
          },
          {
            ...skills[0],
            skillId: 'utility',
            name: 'Utility',
            kind: 'built-in',
            readOnly: true,
          },
        ]}
        onDelete={vi.fn(async () => true)}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => true)}
      />,
    )

    expect(screen.getByText('Research')).toBeTruthy()
    expect(screen.getByText('Utility')).toBeTruthy()
    expect(screen.queryByText('GitLab connector')).toBeNull()
  })

  it('creates stable unique agent IDs from names', () => {
    expect(createAgentId('Release Reviewer', new Set())).toBe('release-reviewer')
    expect(createAgentId('Release Reviewer', new Set(['release-reviewer']))).toBe(
      'release-reviewer-2',
    )
  })

  it('submits prompt, inference, connectors, and skills from the add form', () => {
    const onSubmit = vi.fn(async () => true)
    const onClose = vi.fn()
    render(
      <AgentDrawer
        mode={{ kind: 'create' }}
        existingNodeIds={new Set([existingAgent.id])}
        catalog={catalog}
        connections={connections}
        skills={skills}
        onDelete={vi.fn(async () => true)}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Research agent' } })
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Research {{ topic }} and report the evidence.' },
    })
    fireEvent.click(screen.getByLabelText('Model'))
    const lunaOption = screen.getByRole('option', { name: 'GPT-5.6 Luna' })
    fireEvent.pointerDown(lunaOption, { pointerType: 'mouse' })
    fireEvent.click(lunaOption)
    fireEvent.click(screen.getByLabelText('Thinking effort'))
    const highOption = screen.getByRole('option', { name: 'High' })
    fireEvent.pointerDown(highOption, { pointerType: 'mouse' })
    fireEvent.click(highOption)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: /GitLab/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Research/ }))
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete agent' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))

    expect(onSubmit).toHaveBeenCalledWith({
      connectorIds: ['gitlab-primary'],
      id: 'research-agent',
      inference: {
        connectionId: 'chatgpt-subscription-default',
        modelId: 'gpt-5.6-luna',
        thinkingLevel: 'high',
      },
      name: 'Research agent',
      prompt: 'Research {{ topic }} and report the evidence.',
      skillSnapshotRefs: [
        {
          skillId: 'research',
          snapshotId: `sha256:${'a'.repeat(64)}`,
          digest: 'a'.repeat(64),
          name: 'Research',
          description: 'Find and synthesize evidence.',
        },
      ],
    })
  })

  it('excludes invalid connections and explains that an agent cannot use them', () => {
    render(
      <AgentDrawer
        mode={{ kind: 'create' }}
        existingNodeIds={new Set()}
        catalog={catalog}
        connections={connections.map((item) => ({ ...item, status: 'INVALID' as const }))}
        skills={[]}
        onDelete={vi.fn(async () => true)}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => true)}
      />,
    )

    expect(screen.getByText(/No providers are connected yet/)).toBeTruthy()
    expect(screen.getByText('No connectors are connected yet.')).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'ChatGPT' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /GitLab/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add agent' }).hasAttribute('disabled')).toBe(true)
  })

  it('uses proximity to distinguish fields within sections from separate sections', () => {
    render(
      <AgentDrawer
        mode={{ kind: 'edit', agent: existingAgent }}
        existingNodeIds={new Set([existingAgent.id])}
        catalog={catalog}
        connections={connections}
        skills={skills}
        onDelete={vi.fn(async () => true)}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => true)}
      />,
    )

    const promptSection = screen.getByRole('heading', { name: 'Prompt' }).closest('section')
    const inferenceSection = screen.getByRole('heading', { name: 'Inference' }).closest('section')
    const scrollRegion = promptSection?.parentElement
    const actions = screen.getByRole('button', { name: 'Save changes' }).closest('footer')

    expect(scrollRegion?.className).toContain('gap-8')
    expect(scrollRegion?.className).toContain('content-start')
    expect(promptSection?.className).toContain('gap-3')
    expect(inferenceSection?.className).toContain('gap-3')
    expect(actions?.parentElement).toBe(scrollRegion)
    expect(actions?.previousElementSibling).toBe(
      screen.getByRole('heading', { name: 'Skills' }).closest('section'),
    )
    expect(actions?.className).not.toContain('shrink-0')
    expect(screen.getByLabelText('Prompt').previousElementSibling?.className).toContain('sr-only')
    expect(screen.getByLabelText('Provider').parentElement?.parentElement?.className).toContain(
      'gap-3',
    )
  })

  it('uses the same form for editing, confirms saves, and closes after the transition', async () => {
    const onSubmit = vi.fn(async () => true)
    const onClose = vi.fn()
    const addToast = vi.spyOn(toast, 'add')
    const configuredAgent = AgentNodeSchema.parse({
      ...existingAgent,
      job: {
        ...existingAgent.job,
        prompt: 'Existing {{ subject }} prompt',
        connectorIds: ['gitlab-primary'],
        skillSnapshotRefs: [
          {
            skillId: 'research',
            snapshotId: `sha256:${'a'.repeat(64)}`,
            digest: 'a'.repeat(64),
            name: 'Research',
            description: 'Find and synthesize evidence.',
          },
        ],
      },
    })

    render(
      <AgentDrawer
        mode={{ kind: 'edit', agent: configuredAgent }}
        existingNodeIds={new Set([configuredAgent.id])}
        catalog={catalog}
        connections={connections}
        skills={skills}
        onDelete={vi.fn(async () => true)}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(configuredAgent.name)
    expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe(
      'Existing {{ subject }} prompt',
    )
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Save changes' }).closest('footer')?.className,
    ).not.toContain('border-t')
    expect(screen.getByRole('button', { name: 'Delete agent' })).toBeTruthy()
    expect(screen.queryByText('Identity')).toBeNull()
    expect(screen.queryByLabelText('Agent ID')).toBeNull()
    expect(screen.queryByText('Enter a model ID supported by the provider.')).toBeNull()
    expect(screen.getByLabelText('Provider').tagName).toBe('BUTTON')
    expect(screen.getByLabelText('Model').tagName).toBe('BUTTON')
    expect(screen.getByLabelText('Thinking effort').tagName).toBe('BUTTON')
    expect(
      screen
        .getByRole('heading', { name: 'Skills' })
        .parentElement?.parentElement?.querySelector('svg'),
    ).not.toBeNull()
    expect(
      screen.getByRole('complementary', { name: 'Edit agent' }).parentElement?.className,
    ).toContain('fixed')
    expect(
      screen.getByRole('complementary', { name: 'Edit agent' }).parentElement?.className,
    ).not.toContain('absolute')
    expect((screen.getByRole('checkbox', { name: /GitLab/ }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect((screen.getByRole('checkbox', { name: /Research/ }) as HTMLInputElement).checked).toBe(
      true,
    )

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Updated prompt' } })
    expect(
      (screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ id: configuredAgent.id, prompt: 'Updated prompt' }),
      ),
    )
    expect(addToast).toHaveBeenCalledWith({
      title: 'Agent saved',
      description: `${configuredAgent.name} was updated.`,
      type: 'success',
    })
    const shell = screen.getByRole('complementary', { name: 'Edit agent' }).parentElement
    expect(shell?.getAttribute('data-open')).toBe('false')
    expect(onClose).not.toHaveBeenCalled()
    if (shell === null) throw new Error('Expected the drawer shell')
    fireEvent.transitionEnd(shell, { propertyName: 'translate' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('stays open during canvas interaction and closes only from its close button', async () => {
    const onClose = vi.fn()
    render(
      <AgentDrawer
        mode={{ kind: 'edit', agent: existingAgent }}
        existingNodeIds={new Set([existingAgent.id])}
        catalog={catalog}
        connections={connections}
        skills={skills}
        onDelete={vi.fn(async () => true)}
        onClose={onClose}
        onSubmit={vi.fn(async () => true)}
      />,
    )

    const panel = screen.getByRole('complementary', { name: 'Edit agent' })
    const shell = panel.parentElement
    if (shell === null) throw new Error('Expected the drawer shell')
    await waitFor(() => expect(shell.getAttribute('data-open')).toBe('true'))

    fireEvent.pointerDown(document.body)
    fireEvent.pointerMove(document.body)
    fireEvent.pointerUp(document.body)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(shell.getAttribute('data-open')).toBe('true')
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close agent drawer' }))
    expect(shell.getAttribute('data-open')).toBe('false')
    fireEvent.transitionEnd(shell, { propertyName: 'translate' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('requires the exact agent name before deleting', async () => {
    const onDelete = vi.fn(async () => true)
    render(
      <AgentDrawer
        mode={{ kind: 'edit', agent: existingAgent }}
        existingNodeIds={new Set([existingAgent.id])}
        catalog={catalog}
        connections={connections}
        skills={skills}
        onDelete={onDelete}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => true)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete agent' }))
    expect(onDelete).not.toHaveBeenCalled()
    const confirmationName = screen.getByPlaceholderText('Enter the agent name')
    const confirmation = screen.getByRole('button', { name: 'Confirm' })
    const saveChanges = screen.getByRole('button', { name: 'Save changes' })
    expect(document.activeElement).toBe(confirmationName)
    expect((confirmation as HTMLButtonElement).disabled).toBe(true)
    expect(confirmation.nextElementSibling).toBe(saveChanges)

    fireEvent.change(confirmationName, { target: { value: 'Another agent' } })
    fireEvent.click(confirmation)
    expect(onDelete).not.toHaveBeenCalled()

    fireEvent.change(confirmationName, { target: { value: existingAgent.name } })
    fireEvent.click(confirmation)
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce())
    expect(
      screen
        .getByRole('complementary', { name: 'Edit agent' })
        .parentElement?.getAttribute('data-open'),
    ).toBe('false')
  })

  it('shows catalog and save failures without hiding the form', () => {
    render(
      <AgentDrawer
        mode={{ kind: 'create' }}
        existingNodeIds={new Set()}
        catalog={catalog}
        connections={[]}
        skills={[]}
        catalogError="Agent resources could not be loaded."
        saveError="Workflow could not be saved."
        saving
        onDelete={vi.fn(async () => false)}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => false)}
      />,
    )

    expect(screen.getByText('Agent resources could not be loaded.')).toBeTruthy()
    expect(screen.getByText('Workflow could not be saved.')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Adding agent…' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
