// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HarnessDescriptorSchema, ProjectSchema } from '@slopify/contracts'
import { WorkflowSchema } from '@slopify/workflow-model'

import { StartRunForm } from '../components/runs/start-run-form'
import { ApiClientError, type ApiClient, type StartRunResponse } from '../lib/api-client'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const replace = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))

const baseWorkflow = createAgentWorkflowFixture({
  createdAt: '2026-08-20T10:00:00Z',
  modelId: 'test-model',
  thinkingLevel: 'high',
})

const workflow = WorkflowSchema.parse({
  ...baseWorkflow,
  configuration: {
    projectIds: ['project-api'],
    primaryProjectId: 'project-api',
    variables: ['task', 'iterations'],
  },
  nodes: baseWorkflow.nodes.map((node) => ({
    ...node,
    prompt: 'Deliver {{ task }} in {{ iterations }} passes. Keep \\{{ escaped }} literal.',
  })),
})
const releaseWorkflow = WorkflowSchema.parse({
  ...workflow,
  workflowId: 'release-workflow',
  name: 'Release workflow',
  configuration: { ...workflow.configuration, variables: ['release'] },
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

const startedRun = {
  runId: 'run-01',
  workflowId: workflow.workflowId,
  workflowSnapshot: workflow,
  variables: { task: 'Improve onboarding', iterations: 3 },
  status: 'PENDING',
  transitionCount: 0,
  createdAt: '2026-08-20T10:00:00Z',
  startedAt: null,
  completedAt: null,
} as unknown as StartRunResponse

const createClient = (overrides: Partial<ApiClient> = {}) =>
  ({
    listWorkflows: vi.fn(async () => [workflow]),
    listHarnesses: vi.fn(async () => harnesses),
    listProjects: vi.fn(async () => projects),
    startRun: vi.fn(async () => startedRun),
    ...overrides,
  }) as unknown as ApiClient

afterEach(() => {
  cleanup()
  replace.mockReset()
})

const fillRequiredVariables = async () => {
  fireEvent.change(await screen.findByLabelText('Variable value for task'), {
    target: { value: 'Improve onboarding' },
  })
  fireEvent.change(screen.getByLabelText('Variable value for iterations'), {
    target: { value: '3' },
  })
}

describe('StartRunForm', () => {
  it('loads the URL-selected workflow and retains later selection in the URL', async () => {
    render(
      <StartRunForm
        client={createClient({ listWorkflows: vi.fn(async () => [workflow, releaseWorkflow]) })}
        initialWorkflowId={releaseWorkflow.workflowId}
      />,
    )

    const selector = (await screen.findByLabelText('Workflow')) as HTMLSelectElement
    expect(selector.value).toBe('release-workflow')
    expect(screen.getByText('release')).toBeTruthy()
    expect(screen.queryByText('task')).toBeNull()

    fireEvent.change(selector, { target: { value: workflow.workflowId } })
    expect(await screen.findByText('task')).toBeTruthy()
    expect(replace).toHaveBeenCalledWith('/runs/new?workflowId=default-workflow')
  })

  it('prelists only workflow-configured variables', async () => {
    render(<StartRunForm client={createClient()} />)

    expect(await screen.findByLabelText('Workflow')).toBeTruthy()
    expect(screen.getByText('task')).toBeTruthy()
    expect(screen.getByText('iterations')).toBeTruthy()
    expect(screen.queryByText('escaped')).toBeNull()
  })

  it('lays fixed workflow variables out as two columns without row editing actions', async () => {
    render(<StartRunForm client={createClient()} />)

    const table = await screen.findByRole('table', { name: 'Run variables' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Name', 'Value'])

    const actions = screen.getByTestId('run-variable-actions')
    expect(actions.className).toContain('justify-end')
    expect(screen.queryByRole('button', { name: 'Add variable' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove variable/ })).toBeNull()
    expect(within(table).getAllByRole('row')).toHaveLength(3)
  })

  it('separates variable rows and presents configured names as read-only labels', async () => {
    render(<StartRunForm client={createClient()} />)

    const table = await screen.findByRole('table', { name: 'Run variables' })
    const body = table.querySelector('tbody')
    expect(body?.className).toContain('[&_tr]:border-b')
    expect(table.querySelector('[data-slot="tooltip-trigger"]')).toBeNull()
    expect(within(table).getAllByRole('textbox')).toHaveLength(2)
  })

  it('submits JSON-compatible values for the exact configured names', async () => {
    const startRun = vi.fn(async () => startedRun)
    render(<StartRunForm client={createClient({ startRun })} />)
    await fillRequiredVariables()

    fireEvent.click(screen.getByRole('button', { name: 'Start run' }))

    await waitFor(() =>
      expect(startRun).toHaveBeenCalledWith({
        workflowId: workflow.workflowId,
        variables: {
          task: 'Improve onboarding',
          iterations: 3,
        },
      }),
    )
    expect((await screen.findByRole('link', { name: 'Open run 01' })).getAttribute('href')).toBe(
      '/runs/run-01',
    )
  })

  it('requires every configured value before starting the run', async () => {
    const startRun = vi.fn(async () => startedRun)
    render(<StartRunForm client={createClient({ startRun })} />)

    const start = await screen.findByRole('button', { name: 'Start run' })
    expect((start as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Variable value for task'), {
      target: { value: 'Improve onboarding' },
    })
    expect((start as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Variable value for iterations'), {
      target: { value: '3' },
    })
    expect((start as HTMLButtonElement).disabled).toBe(false)
    expect(startRun).not.toHaveBeenCalled()
  })

  it('keeps starting disabled when a configured project is missing from the host', async () => {
    render(<StartRunForm client={createClient({ listProjects: vi.fn(async () => []) })} />)
    await fillRequiredVariables()

    expect((screen.getByRole('button', { name: 'Start run' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.getByText(/Every selected project must be available/)).toBeTruthy()
  })

  it('shows a run admission error', async () => {
    const startRun = vi.fn(async () => {
      throw new ApiClientError({
        code: 'RUN_ADMISSION_CLOSED',
        message: 'Run admissions are closed',
        status: 503,
      })
    })
    render(<StartRunForm client={createClient({ startRun })} />)
    await fillRequiredVariables()

    fireEvent.click(screen.getByRole('button', { name: 'Start run' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Run admissions are closed')
  })
})
