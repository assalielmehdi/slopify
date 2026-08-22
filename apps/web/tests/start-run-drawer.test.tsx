// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPredefinedV1Workflow, type Workflow } from '@slopify/workflow-model'

import { StartRunDrawer } from '../components/runs/start-run-drawer'
import type { ApiClient, StartRunResponse } from '../lib/api-client'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const baseWorkflow = createPredefinedV1Workflow({
  createdAt: '2026-08-22T10:00:00Z',
  agentDefaults: { provider: 'test-provider', model: 'test-model', thinkingLevel: 'high' },
})
const workflow = {
  ...baseWorkflow,
  name: 'Invisible workflow name',
  nodes: baseWorkflow.nodes.map((node) =>
    node.type === 'agent' ? { ...node, job: { ...node.job, prompt: 'Process {{ topic }}' } } : node,
  ),
} as Workflow
const startedRun = { runId: 'run-01' } as StartRunResponse

afterEach(cleanup)

describe('StartRunDrawer', () => {
  it('starts the current workflow from a variables-only floating panel', async () => {
    const startRun = vi.fn(async () => startedRun)
    const client = {
      listWorkflows: vi.fn(async () => [workflow]),
      startRun,
    } as Pick<ApiClient, 'listWorkflows' | 'startRun'>
    const onStarted = vi.fn()

    render(<StartRunDrawer client={client} onClose={vi.fn()} onStarted={onStarted} />)

    expect(await screen.findByRole('complementary', { name: 'Run' })).toBeTruthy()
    expect(screen.queryByLabelText('Workflow')).toBeNull()
    expect(screen.queryByText('Invisible workflow name')).toBeNull()
    const addVariable = await screen.findByRole('button', { name: 'Add variable' })
    const startRunButton = screen.getByRole('button', { name: 'Start run' })
    const actions = screen.getByTestId('run-variable-actions')
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Run' })?.querySelector('footer')).toBeNull()
    expect(actions.className).toContain('justify-end')
    expect(actions.contains(addVariable)).toBe(true)
    expect(actions.contains(startRunButton)).toBe(true)
    expect(
      addVariable.compareDocumentPosition(startRunButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(addVariable.className).toContain('border-0')
    expect(addVariable.className).not.toContain('underline')
    fireEvent.change(await screen.findByLabelText('Variable value for topic'), {
      target: { value: 'Spacing' },
    })
    fireEvent.click(startRunButton)

    await waitFor(() =>
      expect(startRun).toHaveBeenCalledWith({
        workflowId: workflow.workflowId,
        variables: { topic: 'Spacing' },
      }),
    )
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('run-01'))
  })

  it('stays open during canvas interaction and closes only from its close button', async () => {
    const client = {
      listWorkflows: vi.fn(async () => [workflow]),
      startRun: vi.fn(async () => startedRun),
    } as Pick<ApiClient, 'listWorkflows' | 'startRun'>
    const onClose = vi.fn()

    render(<StartRunDrawer client={client} onClose={onClose} />)

    const panel = await screen.findByRole('complementary', { name: 'Run' })
    const shell = panel.parentElement
    if (shell === null) throw new Error('Expected the drawer shell')
    await waitFor(() => expect(shell.getAttribute('data-open')).toBe('true'))

    fireEvent.pointerDown(document.body)
    fireEvent.pointerMove(document.body)
    fireEvent.pointerUp(document.body)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(shell.getAttribute('data-open')).toBe('true')
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close run drawer' }))
    expect(shell.getAttribute('data-open')).toBe('false')
    fireEvent.transitionEnd(shell, { propertyName: 'translate' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
