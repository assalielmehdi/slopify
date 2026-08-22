// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPredefinedV1Workflow, type Workflow } from '@slopify/workflow-model'

import { StartRunForm } from '../components/runs/start-run-form'
import { ApiClientError, type ApiClient, type StartRunResponse } from '../lib/api-client'

const baseWorkflow = createPredefinedV1Workflow({
  createdAt: '2026-08-20T10:00:00Z',
  agentDefaults: {
    provider: 'test-provider',
    model: 'test-model',
    thinkingLevel: 'high',
  },
})

const workflow = {
  ...baseWorkflow,
  nodes: baseWorkflow.nodes.map((node) =>
    node.type === 'agent'
      ? {
          ...node,
          job: {
            ...node.job,
            prompt: 'Deliver {{ task }} in {{ iterations }} passes. Keep \\{{ escaped }} literal.',
          },
        }
      : node,
  ),
} as Workflow

const startedRun = {
  runId: 'run-01',
  workflowId: workflow.workflowId,
  workflowSnapshot: workflow,
  variables: { task: 'Improve onboarding', iterations: 3 },
  missingVariables: [],
  status: 'PENDING',
  currentNodeId: null,
  transitionCount: 0,
  createdAt: '2026-08-20T10:00:00Z',
  startedAt: null,
  completedAt: null,
} as unknown as StartRunResponse

const createClient = (overrides: Partial<ApiClient> = {}) =>
  ({
    listWorkflows: vi.fn(async () => [workflow]),
    startRun: vi.fn(async () => startedRun),
    ...overrides,
  }) as unknown as ApiClient

afterEach(cleanup)

const fillRequiredVariables = async () => {
  fireEvent.change(await screen.findByLabelText('Variable value for task'), {
    target: { value: 'Improve onboarding' },
  })
  fireEvent.change(screen.getByLabelText('Variable value for iterations'), {
    target: { value: '3' },
  })
}

describe('StartRunForm', () => {
  it('prelists prompt variables and removes delivery-specific run fields', async () => {
    render(<StartRunForm client={createClient()} />)

    expect(await screen.findByLabelText('Workflow')).toBeTruthy()
    expect(screen.getByDisplayValue('task')).toBeTruthy()
    expect(screen.getByDisplayValue('iterations')).toBeTruthy()
    expect(screen.queryByDisplayValue('escaped')).toBeNull()
    expect(screen.queryByLabelText('Project profile')).toBeNull()
    expect(screen.queryByLabelText('ClickUp task ID or URL')).toBeNull()
    expect(screen.queryByLabelText('Run notes')).toBeNull()
  })

  it('lays variables out as two columns and appends new rows before the add action', async () => {
    render(<StartRunForm client={createClient()} />)

    const table = await screen.findByRole('table', { name: 'Run variables' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Name', 'Value'])

    const addVariable = screen.getByRole('button', { name: 'Add variable' })
    const actions = screen.getByTestId('run-variable-actions')
    expect(
      table.compareDocumentPosition(addVariable) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(actions.className).toContain('justify-end')
    expect(addVariable.className).toContain('border-0')
    expect(addVariable.className).not.toContain('underline')

    fireEvent.click(addVariable)

    const variableNames = within(table)
      .getAllByRole('textbox')
      .filter((input) => input.getAttribute('aria-label')?.startsWith('Variable name'))
      .map((input) => (input as HTMLInputElement).value)
    expect(variableNames).toEqual(['task', 'iterations', ''])
    expect(within(table).getAllByRole('row')).toHaveLength(4)
  })

  it('separates variable rows and discloses prompt requirements from the variable name', async () => {
    render(<StartRunForm client={createClient()} />)

    const table = await screen.findByRole('table', { name: 'Run variables' })
    const body = table.querySelector('tbody')
    expect(body?.className).toContain('[&_tr]:border-b')
    expect(screen.queryByText('Required by a prompt')).toBeNull()

    const requirementTrigger = table.querySelector('[data-slot="tooltip-trigger"]')
    expect(requirementTrigger).not.toBeNull()
    expect(requirementTrigger?.getAttribute('aria-label')).toBe('task is required by a prompt')
  })

  it('submits JSON-compatible values and arbitrary variables', async () => {
    const startRun = vi.fn(async () => startedRun)
    render(<StartRunForm client={createClient({ startRun })} />)
    await fillRequiredVariables()

    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
    fireEvent.change(screen.getByLabelText('Variable name 3'), { target: { value: 'context' } })
    fireEvent.change(screen.getByLabelText('Variable value for context'), {
      target: { value: '{"owner":"delivery"}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }))

    await waitFor(() =>
      expect(startRun).toHaveBeenCalledWith({
        workflowId: workflow.workflowId,
        variables: {
          task: 'Improve onboarding',
          iterations: 3,
          context: { owner: 'delivery' },
        },
      }),
    )
    expect((await screen.findByRole('link', { name: 'Open run 01' })).getAttribute('href')).toBe(
      '/runs/run-01',
    )
  })

  it('omits blank prompt-variable rows so the server can report them as missing', async () => {
    const startRun = vi.fn<ApiClient['startRun']>().mockRejectedValueOnce(
      new ApiClientError({
        code: 'RUN_VARIABLES_MISSING',
        message: 'Some prompt variables are missing.',
        status: 409,
        details: { missingVariables: ['task', 'iterations'] },
      }),
    )
    render(<StartRunForm client={createClient({ startRun })} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Start run' }))

    await waitFor(() =>
      expect(startRun).toHaveBeenCalledWith({
        workflowId: workflow.workflowId,
        variables: {},
      }),
    )
    expect(await screen.findByText('Missing prompt variables')).toBeTruthy()
  })

  it('allows arbitrary variable rows to be removed', async () => {
    render(<StartRunForm client={createClient()} />)
    await screen.findByLabelText('Workflow')

    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }))
    fireEvent.change(screen.getByLabelText('Variable name 3'), { target: { value: 'temporary' } })
    expect(screen.getByLabelText('Variable value for temporary')).toBeTruthy()

    const removeVariable = screen.getByRole('button', { name: 'Remove variable temporary' })
    expect(removeVariable.querySelector('.lucide-trash-2')).not.toBeNull()
    expect(removeVariable.className).toContain('hover:text-destructive')
    expect(removeVariable.className).toContain('focus-visible:text-destructive')
    fireEvent.click(removeVariable)
    expect(screen.queryByLabelText('Variable value for temporary')).toBeNull()
  })

  it('requires an explicit second action when the server reports missing variables', async () => {
    const startRun = vi
      .fn<ApiClient['startRun']>()
      .mockRejectedValueOnce(
        new ApiClientError({
          code: 'RUN_VARIABLES_MISSING',
          message: 'Some prompt variables are missing.',
          status: 409,
          details: { missingVariables: ['optional_context'] },
        }),
      )
      .mockResolvedValueOnce(startedRun)
    render(<StartRunForm client={createClient({ startRun })} />)
    await fillRequiredVariables()

    fireEvent.click(screen.getByRole('button', { name: 'Start run' }))

    expect(await screen.findByText('Missing prompt variables')).toBeTruthy()
    expect(
      screen.getByText('Starting anyway substitutes an empty value for each missing variable.'),
    ).toBeTruthy()
    expect(screen.getByText('optional_context')).toBeTruthy()
    expect(startRun).toHaveBeenCalledTimes(1)
    expect(startRun).toHaveBeenLastCalledWith({
      workflowId: workflow.workflowId,
      variables: { task: 'Improve onboarding', iterations: 3 },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Start without missing variables' }))

    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(2))
    expect(startRun).toHaveBeenLastCalledWith({
      workflowId: workflow.workflowId,
      variables: { task: 'Improve onboarding', iterations: 3 },
      confirmMissingVariables: true,
    })
  })

  it('resets missing-variable confirmation after an edit', async () => {
    const startRun = vi.fn(async () => {
      throw new ApiClientError({
        code: 'RUN_VARIABLES_MISSING',
        message: 'Some prompt variables are missing.',
        status: 409,
        details: { missingVariables: ['optional_context'] },
      })
    })
    render(<StartRunForm client={createClient({ startRun })} />)
    await fillRequiredVariables()
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }))
    expect(
      await screen.findByRole('button', { name: 'Start without missing variables' }),
    ).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Variable value for task'), {
      target: { value: 'Refine navigation' },
    })

    expect(screen.queryByText('Missing prompt variables')).toBeNull()
    expect(screen.getByRole('button', { name: 'Start run' })).toBeTruthy()
  })

  it('links to the active run when the server rejects a competing start', async () => {
    const startRun = vi.fn(async () => {
      throw new ApiClientError({
        code: 'RUN_ACTIVE',
        message: 'Another run is already active',
        status: 409,
        details: { activeRunId: 'run-active-01' },
      })
    })
    render(<StartRunForm client={createClient({ startRun })} />)
    await fillRequiredVariables()

    fireEvent.click(screen.getByRole('button', { name: 'Start run' }))

    expect(
      (await screen.findByRole('link', { name: 'Open active run active-01' })).getAttribute('href'),
    ).toBe('/runs/run-active-01')
  })
})
