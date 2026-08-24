// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HarnessDescriptorSchema, ProjectSchema } from '@slopify/contracts'
import { WorkflowSchema } from '@slopify/workflow-model'

import { StartRunDrawer } from '../components/runs/start-run-drawer'
import type { ApiClient, StartRunResponse } from '../lib/api-client'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const push = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const baseWorkflow = createAgentWorkflowFixture({
  createdAt: '2026-08-22T10:00:00Z',
  modelId: 'test-model',
  thinkingLevel: 'high',
})
const workflow = WorkflowSchema.parse({
  ...baseWorkflow,
  name: 'Invisible workflow name',
  configuration: {
    projectIds: ['project-api'],
    primaryProjectId: 'project-api',
    variables: ['topic'],
  },
  nodes: baseWorkflow.nodes.map((node) => ({ ...node, prompt: 'Process {{ topic }}' })),
})
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
    models: [{ id: 'test-model', name: 'Test model', thinkingLevels: ['high'] }],
  },
])
const projects = ProjectSchema.array().parse([
  {
    projectId: 'project-api',
    name: 'API',
    provider: 'GITHUB',
    remoteId: '101',
    fullName: 'operator/api',
    cloneUrl: 'https://github.com/operator/api.git',
    webUrl: 'https://github.com/operator/api',
    defaultBranch: 'main',
    availability: 'AVAILABLE',
    createdAt: '2026-08-23T10:00:00Z',
    updatedAt: '2026-08-23T10:00:00Z',
  },
])
const startedRun = { runId: 'run-01' } as StartRunResponse

afterEach(() => {
  cleanup()
  push.mockReset()
})

describe('StartRunDrawer', () => {
  it('starts the current workflow from a variables-only floating panel', async () => {
    const startRun = vi.fn(async () => startedRun)
    const client = {
      listWorkflows: vi.fn(async () => [workflow]),
      listHarnesses: vi.fn(async () => harnesses),
      listProjects: vi.fn(async () => projects),
      startRun,
    } as Pick<ApiClient, 'listHarnesses' | 'listProjects' | 'listWorkflows' | 'startRun'>
    const onStarted = vi.fn()

    render(<StartRunDrawer client={client} onClose={vi.fn()} onStarted={onStarted} />)

    expect(await screen.findByRole('complementary', { name: 'Run' })).toBeTruthy()
    expect(screen.queryByLabelText('Workflow')).toBeNull()
    expect(screen.queryByText('Invisible workflow name')).toBeNull()
    const startRunButton = await screen.findByRole('button', { name: 'Start run' })
    const actions = screen.getByTestId('run-variable-actions')
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Run' })?.querySelector('footer')).toBeNull()
    expect(actions.className).toContain('justify-end')
    expect(actions.contains(startRunButton)).toBe(true)
    expect(screen.queryByRole('button', { name: 'Add variable' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove variable/ })).toBeNull()
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
    expect(push).toHaveBeenCalledWith('/runs/run-01')
  })

  it('stays open during canvas interaction and closes only from its close button', async () => {
    const client = {
      listWorkflows: vi.fn(async () => [workflow]),
      listHarnesses: vi.fn(async () => harnesses),
      listProjects: vi.fn(async () => projects),
      startRun: vi.fn(async () => startedRun),
    } as Pick<ApiClient, 'listHarnesses' | 'listProjects' | 'listWorkflows' | 'startRun'>
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
