// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HarnessDescriptorSchema } from '@slopify/contracts'
import { AgentNodeSchema } from '@slopify/workflow-model'

import { AgentDrawer } from '../components/workflow/agent-drawer'
import { createAgentId } from '../lib/agent-drawer'
import { toast } from '../lib/toast'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const workflow = createAgentWorkflowFixture({
  createdAt: '2026-08-18T12:00:00Z',
  modelId: 'openai/gpt-5.4',
  thinkingLevel: 'medium',
})

const existingAgent = workflow.nodes[0]
if (existingAgent === undefined) throw new Error('Expected an agent fixture')

const harnesses = HarnessDescriptorSchema.array().parse([
  {
    harnessId: 'pi',
    name: 'Pi',
    description: 'Runs the locally installed Pi coding agent.',
    availability: 'AVAILABLE',
    executablePath: '/opt/homebrew/bin/pi',
    version: '0.84.2',
    installHref: 'https://pi.dev/',
    installLabel: 'Install Pi',
    models: [
      {
        id: 'openai/gpt-5.4',
        name: 'GPT-5.4',
        thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      },
      {
        id: 'openai/gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
    ],
  },
])

afterEach(cleanup)

describe('AgentDrawer', () => {
  it('creates stable unique agent IDs from names', () => {
    expect(createAgentId('Release Reviewer', new Set())).toBe('release-reviewer')
    expect(createAgentId('Release Reviewer', new Set(['release-reviewer']))).toBe(
      'release-reviewer-2',
    )
  })

  it('submits the harness with optional model and thinking preferences', async () => {
    const onSubmit = vi.fn(async () => true)
    render(
      <AgentDrawer
        mode={{ kind: 'create' }}
        existingNodeIds={new Set([existingAgent.id])}
        harnesses={harnesses}
        onDelete={vi.fn(async () => true)}
        onClose={vi.fn()}
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
    fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        id: 'research-agent',
        name: 'Research agent',
        prompt: 'Research {{ topic }} and report the evidence.',
        harness: {
          harnessId: 'pi',
          modelId: 'openai/gpt-5.6-luna',
          thinkingLevel: 'high',
        },
      }),
    )
  })

  it('allows Pi to resolve the default model and thinking effort', async () => {
    const onSubmit = vi.fn(async () => true)
    render(
      <AgentDrawer
        mode={{ kind: 'create' }}
        existingNodeIds={new Set()}
        harnesses={harnesses}
        onDelete={vi.fn(async () => true)}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Default agent' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Do the work.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add agent' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        id: 'default-agent',
        name: 'Default agent',
        prompt: 'Do the work.',
        harness: { harnessId: 'pi' },
      }),
    )
  })

  it('explains why creating agents is blocked when no harness is available', () => {
    const unavailable = HarnessDescriptorSchema.array().parse([
      {
        harnessId: 'pi',
        name: 'Pi',
        description: 'Runs the locally installed Pi coding agent.',
        availability: 'UNAVAILABLE',
        unavailableReason: 'Pi was not found on PATH.',
        installHref: 'https://pi.dev/',
        installLabel: 'Install Pi',
        models: [],
      },
    ])
    render(
      <AgentDrawer
        mode={{ kind: 'create' }}
        existingNodeIds={new Set()}
        harnesses={unavailable}
        onDelete={vi.fn(async () => true)}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => true)}
      />,
    )

    expect(screen.getByText('Pi was not found on PATH.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Harnesses' }).getAttribute('href')).toBe(
      '/harnesses',
    )
    expect((screen.getByRole('button', { name: 'Add agent' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('edits existing harness configuration and closes after the transition', async () => {
    const onSubmit = vi.fn(async () => true)
    const onClose = vi.fn()
    const addToast = vi.spyOn(toast, 'add')
    const configuredAgent = AgentNodeSchema.parse({
      ...existingAgent,
      prompt: 'Existing {{ subject }} prompt',
      harness: {
        harnessId: 'pi',
        modelId: 'openai/gpt-5.4',
        thinkingLevel: 'medium',
      },
    })

    render(
      <AgentDrawer
        mode={{ kind: 'edit', agent: configuredAgent }}
        existingNodeIds={new Set([configuredAgent.id])}
        harnesses={harnesses}
        onDelete={vi.fn(async () => true)}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    )

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(configuredAgent.name)
    expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe(
      'Existing {{ subject }} prompt',
    )
    expect(
      (screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByLabelText('Harness').tagName).toBe('BUTTON')
    expect(screen.getByLabelText('Model').tagName).toBe('BUTTON')
    expect(screen.getByLabelText('Thinking effort').tagName).toBe('BUTTON')

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Updated prompt' } })
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

  it('identifies a configured model that disappeared from the harness catalog', () => {
    const configuredAgent = AgentNodeSchema.parse({
      ...existingAgent,
      prompt: 'Existing prompt',
      harness: {
        harnessId: 'pi',
        modelId: 'openai/gpt-5.4',
        thinkingLevel: 'medium',
      },
    })
    const changedCatalog = HarnessDescriptorSchema.array().parse([
      {
        ...harnesses[0],
        models: harnesses[0]?.models.filter(({ id }) => id !== 'openai/gpt-5.4'),
      },
    ])

    render(
      <AgentDrawer
        mode={{ kind: 'edit', agent: configuredAgent }}
        existingNodeIds={new Set([configuredAgent.id])}
        harnesses={changedCatalog}
        onDelete={vi.fn(async () => true)}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => true)}
      />,
    )

    expect(screen.getByLabelText('Model').textContent).toContain('openai/gpt-5.4 (unavailable)')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated agent' } })
    expect(
      (screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('requires the exact agent name before deleting', async () => {
    const onDelete = vi.fn(async () => true)
    render(
      <AgentDrawer
        mode={{ kind: 'edit', agent: existingAgent }}
        existingNodeIds={new Set([existingAgent.id])}
        harnesses={harnesses}
        onDelete={onDelete}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => true)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete agent' }))
    const confirmationName = screen.getByPlaceholderText('Enter the agent name')
    const confirmation = screen.getByRole('button', { name: 'Confirm' })
    expect((confirmation as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(confirmationName, { target: { value: existingAgent.name } })
    fireEvent.click(confirmation)
    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce())
  })
})
