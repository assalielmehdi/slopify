// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkflowSchema, type Workflow } from '@slopify/shared'
import { HarnessDescriptorSchema, RepositorySchema } from '@slopify/shared'

import { WorkflowWorkbench } from '../components/workflow/workflow-workbench'
import type { ResourceEventStreamHandlers } from '../lib/resource-event-stream'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
}))

vi.mock('../components/workflow/workflow-canvas', () => ({
  WorkflowCanvas: ({
    workflow,
    onNodeSelect,
    onConfigure,
    onRun,
    runDisabledReason,
    runnable,
  }: {
    workflow: { nodes: readonly unknown[]; edges: readonly unknown[] }
    onNodeSelect: (nodeId: string) => void
    onConfigure: () => void
    onRun: () => void
    runDisabledReason?: string
    runnable: boolean
  }) => (
    <div aria-label="Workflow graph" role="region">
      Graph {workflow.nodes.length} nodes, {workflow.edges.length} edges
      <button onClick={() => onNodeSelect('identify-agent')}>Select agent</button>
      <button onClick={onConfigure}>Configure workflow</button>
      <button disabled={!runnable} title={runDisabledReason} onClick={onRun}>
        Run
      </button>
    </div>
  ),
}))

vi.mock('../components/workflow/workflow-config-panel', () => ({
  WorkflowConfigPanel: ({
    conflict,
    onClose,
    onDelete,
    onDirtyChange,
    onSubmit,
    value,
  }: {
    conflict?: string
    onClose: () => void
    onDelete: () => Promise<boolean>
    onDirtyChange?: (dirty: boolean) => void
    onSubmit: (value: unknown) => Promise<boolean>
    value: Workflow
  }) => (
    <aside aria-label="Workflow configuration" data-layout="workspace">
      {conflict === undefined ? null : <p>{conflict}</p>}
      <button onClick={() => onDirtyChange?.(true)}>Edit graph source</button>
      <button onClick={onClose}>Close workflow configuration</button>
      <button onClick={() => void onDelete()}>Delete workflow</button>
      <button
        onClick={() =>
          void onSubmit({
            ...value,
            description: 'Updated workflow details.',
            configuration: {
              repositoryIds: ['repository-api'],
              primaryRepositoryId: 'repository-api',
              variables: ['topic', 'release'],
            },
          })
        }
      >
        Save workflow configuration
      </button>
    </aside>
  ),
}))

vi.mock('../components/runs/start-run-panel', () => ({
  StartRunPanel: ({ onClose }: { onClose: () => void }) => (
    <aside aria-label="Run" data-layout="workspace">
      <p>Variables</p>
      <button onClick={onClose}>Cancel run</button>
    </aside>
  ),
}))

const workflowTemplate = createAgentWorkflowFixture({
  createdAt: '2026-08-18T12:00:00Z',
  modelId: 'test-model',
  thinkingLevel: 'high',
})
const workflow = WorkflowSchema.parse({
  ...workflowTemplate,
  configuration: {
    repositoryIds: ['repository-api'],
    primaryRepositoryId: 'repository-api',
    variables: [],
  },
})
const catalog = [workflow] as const
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
        id: 'test-model',
        name: 'Test model',
        thinkingLevels: ['high'],
      },
      {
        id: 'openai/gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        thinkingLevels: ['high'],
      },
    ],
  },
  {
    harnessId: 'codex',
    name: 'Codex',
    description: 'Runs the locally installed Codex coding agent.',
    availability: 'AVAILABLE',
    executablePath: '/opt/homebrew/bin/codex',
    version: '0.1.0',
    installHref: 'https://developers.openai.com/codex/',
    installLabel: 'Install Codex',
    models: [
      {
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        thinkingLevels: ['high', 'xhigh'],
      },
    ],
  },
])
const repositories = RepositorySchema.array().parse([
  {
    repositoryId: 'repository-api',
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('WorkflowWorkbench', () => {
  it('loads the complete initial screen without issuing resource-by-resource requests', async () => {
    const client = {
      deleteWorkflow: vi.fn(),
      getWorkflow: vi.fn(),
      getWorkflowScreen: vi.fn(async () => ({
        selectedWorkflow: workflow,
        workflows: catalog,
        harnesses,
        repositories,
      })),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(),
      listRepositories: vi.fn(),
      listWorkflows: vi.fn(),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} selectedWorkflowId={workflow.workflowId} />)

    expect(await screen.findByText('Graph 1 nodes, 0 edges')).toBeTruthy()
    expect(client.getWorkflowScreen).toHaveBeenCalledWith(workflow.workflowId)
    expect(client.getWorkflow).not.toHaveBeenCalled()
    expect(client.listHarnesses).not.toHaveBeenCalled()
    expect(client.listRepositories).not.toHaveBeenCalled()
    expect(client.listWorkflows).not.toHaveBeenCalled()
  })

  it('shows the empty state without duplicating workflow creation controls', async () => {
    const client = {
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => []),
      getWorkflow: vi.fn(),
      updateWorkflow: vi.fn(),
      listHarnesses: vi.fn(async () => harnesses),
      listRepositories: vi.fn(async () => repositories),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    expect(await screen.findByText('Create your first workflow')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New workflow' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Workflow' })).toBeNull()
  })

  it('loads the URL-selected workflow without a second workflow selector', async () => {
    const firstAgent = workflow.nodes[0]
    if (firstAgent === undefined) throw new Error('Expected an agent fixture')
    const releaseWorkflow = WorkflowSchema.parse({
      ...workflow,
      workflowId: 'release-workflow',
      nodes: [firstAgent, { ...firstAgent, id: 'review-agent', name: 'Review agent' }],
      updatedAt: '2026-08-24T15:00:00.000Z',
    })
    const workflows = [releaseWorkflow, workflow]
    const client = {
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => workflows),
      getWorkflow: vi.fn(async (workflowId: string) => {
        const selected = workflows.find((candidate) => candidate.workflowId === workflowId)
        if (selected === undefined) throw new Error('Workflow was not found')
        return selected
      }),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => harnesses),
      listRepositories: vi.fn(async () => repositories),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} selectedWorkflowId="release-workflow" />)

    expect(await screen.findByText('Graph 2 nodes, 0 edges')).toBeTruthy()
    expect(client.getWorkflow).toHaveBeenCalledWith('release-workflow')
    expect(screen.queryByRole('combobox', { name: 'Workflow' })).toBeNull()
  })

  it('falls back to the newest workflow and normalizes an invalid URL selection', async () => {
    const releaseWorkflow = WorkflowSchema.parse({
      ...workflow,
      workflowId: 'release-workflow',
      updatedAt: '2026-08-24T15:00:00.000Z',
    })
    const client = {
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => [releaseWorkflow, workflow]),
      getWorkflow: vi.fn(async () => releaseWorkflow),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => harnesses),
      listRepositories: vi.fn(async () => repositories),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} selectedWorkflowId="missing-workflow" />)

    expect(await screen.findByText('Graph 1 nodes, 0 edges')).toBeTruthy()
    expect(client.getWorkflow).toHaveBeenCalledWith('release-workflow')
    expect(navigation.replace).toHaveBeenCalledWith('/?workflowId=release-workflow')
  })

  it('keeps the graph and workflow details in persistent workspace panes', async () => {
    const client = {
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn(async () => workflow),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => harnesses),
      listRepositories: vi.fn(async () => repositories),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    expect(await screen.findByText('Graph 1 nodes, 0 edges')).toBeTruthy()
    expect(client.getWorkflow).toHaveBeenCalledWith('test-workflow')
    expect(screen.getByRole('region', { name: 'Workflow graph pane' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Workflow details pane' })).toBeTruthy()
    const overview = screen.getByRole('complementary', { name: 'Workflow overview' })
    const overviewHeader = overview.querySelector('header')
    if (overviewHeader === null) throw new Error('Expected the workflow overview header')
    expect(overviewHeader.getAttribute('data-slot')).toBe('workspace-panel-header')
    expect(overviewHeader.className).toContain('shrink-0')
    expect(overviewHeader.className).toContain('p-6')
    expect(overviewHeader.querySelector('svg')).toBeTruthy()
    expect(within(overviewHeader).getByRole('heading', { name: 'Overview' })).toBeTruthy()
    expect(within(overviewHeader).queryByText(workflow.description)).toBeNull()
    expect(within(overview).getByRole('heading', { name: 'Description' })).toBeTruthy()
    expect(within(overview).getByText(workflow.description)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(screen.getByRole('complementary', { name: 'Run' }).getAttribute('data-layout')).toBe(
      'workspace',
    )
    expect(screen.getByRole('region', { name: 'Workflow graph' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: workflow.workflowId })).toBeNull()
    expect(screen.queryByText(workflow.description)).toBeNull()
    expect(screen.queryByText(/version/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Add agent/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Connect agents/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Select agent' }))
    expect(
      screen.getByRole('complementary', { name: 'Agent configuration: Who are you?' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Close agent configuration' })).toBeNull()
    expect(screen.getByText("Who are you? What's your name?")).toBeTruthy()
  })

  it('opens workflow configuration beside the run action and persists it on the workflow', async () => {
    const updateWorkflow = vi.fn(async (_workflowId, next) => next)
    const client = {
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn(async () => workflow),
      updateWorkflow,
      listHarnesses: vi.fn(async () => harnesses),
      listRepositories: vi.fn(async () => repositories),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    await screen.findByText('Graph 1 nodes, 0 edges')
    fireEvent.click(screen.getByRole('button', { name: 'Configure workflow' }))
    expect(
      screen
        .getByRole('complementary', { name: 'Workflow configuration' })
        .getAttribute('data-layout'),
    ).toBe('workspace')
    fireEvent.click(screen.getByRole('button', { name: 'Save workflow configuration' }))

    await waitFor(() =>
      expect(updateWorkflow).toHaveBeenCalledWith(
        workflow.workflowId,
        expect.objectContaining({
          workflowId: workflow.workflowId,
          description: 'Updated workflow details.',
          configuration: {
            repositoryIds: ['repository-api'],
            primaryRepositoryId: 'repository-api',
            variables: ['topic', 'release'],
          },
        }),
      ),
    )
    expect(screen.queryByRole('combobox', { name: 'Workflow' })).toBeNull()
  })

  it('edits and persists the selected agent configuration', async () => {
    const updateWorkflow = vi.fn(async (_workflowId, next) => next)
    const client = {
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn(async () => workflow),
      updateWorkflow,
      listHarnesses: vi.fn(async () => harnesses),
      listRepositories: vi.fn(async () => repositories),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    await screen.findByText('Graph 1 nodes, 0 edges')
    fireEvent.click(screen.getByRole('button', { name: 'Select agent' }))
    const panel = screen.getByRole('complementary', {
      name: 'Agent configuration: Who are you?',
    })
    const header = panel.querySelector('header')
    if (header === null) throw new Error('Expected the agent configuration header')
    expect(header.getAttribute('data-slot')).toBe('workspace-panel-header')
    expect(within(header).getByRole('heading', { name: 'Edit agent' })).toBeTruthy()
    expect(
      within(header).getByText("Update this agent's prompt and runtime configuration."),
    ).toBeTruthy()
    expect(within(header).queryByText('Who are you?')).toBeNull()
    const name = within(panel).getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    const prompt = within(panel).getByLabelText('Prompt')
    const harness = within(panel).getByRole('combobox', { name: 'Harness' })
    const timeout = within(panel).getByLabelText('Timeout (minutes)')

    expect(name.value).toBe('Who are you?')
    expect(name.readOnly).toBe(true)
    expect((prompt as HTMLTextAreaElement).value).toBe("Who are you? What's your name?")
    expect(harness.getAttribute('data-slot')).toBe('select-trigger')
    expect((timeout as HTMLInputElement).value).toBe('15')
    expect(
      (within(panel).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    fireEvent.change(prompt, { target: { value: 'Implement the selected task.' } })
    fireEvent.click(harness)
    const codexOption = screen.getByRole('option', { name: 'Codex' })
    fireEvent.pointerDown(codexOption, { pointerType: 'mouse' })
    fireEvent.click(codexOption)

    const model = within(panel).getByRole('combobox', { name: 'Model' })
    fireEvent.click(model)
    const modelOption = screen.getByRole('option', { name: 'GPT-5.6 Sol' })
    fireEvent.pointerDown(modelOption, { pointerType: 'mouse' })
    fireEvent.click(modelOption)

    const thinking = within(panel).getByRole('combobox', { name: 'Thinking' })
    fireEvent.click(thinking)
    const thinkingOption = screen.getByRole('option', { name: 'xhigh' })
    fireEvent.pointerDown(thinkingOption, { pointerType: 'mouse' })
    fireEvent.click(thinkingOption)
    fireEvent.change(timeout, { target: { value: '20' } })
    const form = panel.querySelector('form')
    if (form === null) throw new Error('Expected the agent configuration form')
    fireEvent.submit(form)

    await waitFor(() =>
      expect(updateWorkflow).toHaveBeenCalledWith(
        workflow.workflowId,
        expect.objectContaining({
          nodes: [
            expect.objectContaining({
              id: 'identify-agent',
              prompt: 'Implement the selected task.',
              harness: {
                harnessId: 'codex',
                modelId: 'gpt-5.6-sol',
                thinkingLevel: 'xhigh',
              },
              timeoutSeconds: 1_200,
            }),
          ],
        }),
      ),
    )
    expect(screen.getByRole('complementary', { name: 'Workflow overview' })).toBeTruthy()
  })

  it('protects a dirty agent configuration from external workflow changes', async () => {
    let handlers: ResourceEventStreamHandlers | undefined
    const externalWorkflow = WorkflowSchema.parse({
      ...workflow,
      description: 'Externally changed workflow details.',
      updatedAt: '2026-08-25T20:00:00.000Z',
    })
    const client = {
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn().mockResolvedValueOnce(workflow).mockResolvedValue(externalWorkflow),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => harnesses),
      listRepositories: vi.fn(async () => repositories),
      startRun: vi.fn(),
    }
    render(
      <WorkflowWorkbench
        client={client}
        connectResourceEvents={(nextHandlers) => {
          handlers = nextHandlers
          return vi.fn()
        }}
      />,
    )

    await screen.findByText('Graph 1 nodes, 0 edges')
    fireEvent.click(screen.getByRole('button', { name: 'Select agent' }))
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Unsaved local prompt.' },
    })
    await act(async () =>
      handlers?.onEvent({
        sequence: 1,
        timestamp: '2026-08-25T20:00:00.000Z',
        change: 'CHANGED',
        resource: { type: 'WORKFLOW', workflowId: workflow.workflowId },
        revision: 'a'.repeat(64),
      }),
    )

    expect(screen.getByText(/changed outside Slopify/i)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(client.updateWorkflow).not.toHaveBeenCalled()

    expect(screen.queryByRole('button', { name: 'Close agent configuration' })).toBeNull()
  })

  it('deletes the current workflow and selects the next remaining workflow', async () => {
    const remainingWorkflow = WorkflowSchema.parse({
      ...workflow,
      workflowId: 'remaining-workflow',
    })
    const deleteWorkflow = vi.fn(async () => undefined)
    const client = {
      deleteWorkflow,
      listWorkflows: vi
        .fn()
        .mockResolvedValueOnce([workflow, remainingWorkflow])
        .mockResolvedValueOnce([remainingWorkflow]),
      getWorkflow: vi.fn(async () => workflow),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => harnesses),
      listRepositories: vi.fn(async () => repositories),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} selectedWorkflowId={workflow.workflowId} />)

    await screen.findByText('Graph 1 nodes, 0 edges')
    fireEvent.click(screen.getByRole('button', { name: 'Configure workflow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete workflow' }))

    await waitFor(() => expect(deleteWorkflow).toHaveBeenCalledWith(workflow.workflowId))
    expect(navigation.replace).toHaveBeenLastCalledWith('/?workflowId=remaining-workflow')
  })

  it('shows a structured error state when the workflow catalog cannot be loaded', async () => {
    const client = {
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => {
        throw new Error('Workflow catalog unavailable')
      }),
      getWorkflow: vi.fn(),
      updateWorkflow: vi.fn(),
      listHarnesses: vi.fn(async () => harnesses),
      listRepositories: vi.fn(async () => repositories),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    expect((await screen.findByRole('alert')).textContent).toContain('Workflow catalog unavailable')
  })

  it('renders a zero-node workflow as an empty non-runnable canvas', async () => {
    const emptyWorkflow = {
      ...workflow,
      startNodeId: null,
      nodes: [],
      edges: [],
    } as unknown as Workflow
    const client = {
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => [emptyWorkflow]),
      getWorkflow: vi.fn(async () => emptyWorkflow),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => harnesses),
      listRepositories: vi.fn(async () => repositories),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    expect(await screen.findByText('Graph 0 nodes, 0 edges')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /Add/ })).toBeNull()
  })

  it('keeps the graph readable but blocks running without Pi', async () => {
    const unavailableHarnesses = HarnessDescriptorSchema.array().parse([
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
    const client = {
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn(async () => workflow),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => unavailableHarnesses),
      listRepositories: vi.fn(async () => repositories),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    await screen.findByText('Graph 1 nodes, 0 edges')
    expect(screen.queryByRole('button', { name: /Add agent/ })).toBeNull()
    const run = screen.getByRole('button', { name: 'Run' })
    expect((run as HTMLButtonElement).disabled).toBe(true)
    expect(run.getAttribute('title')).toContain('Pi is unavailable')

    fireEvent.click(screen.getByRole('button', { name: 'Select agent' }))
    const panel = screen.getByRole('complementary', {
      name: 'Agent configuration: Who are you?',
    })
    expect(within(panel).getByLabelText('Prompt')).toBeTruthy()
    expect(within(panel).getByRole('combobox', { name: 'Harness' })).toBeTruthy()
  })

  it('blocks running when a configured repository is missing from the host catalog', async () => {
    const client = {
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn(async () => workflow),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => harnesses),
      listRepositories: vi.fn(async () => []),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    await screen.findByText('Graph 1 nodes, 0 edges')
    const run = screen.getByRole('button', { name: 'Run' })
    expect((run as HTMLButtonElement).disabled).toBe(true)
    expect(run.getAttribute('title')).toContain('Every selected repository must be available')
  })

  it('preserves a dirty editor and surfaces an external workflow conflict', async () => {
    let handlers: ResourceEventStreamHandlers | undefined
    const externalWorkflow = WorkflowSchema.parse({
      ...workflow,
      description: 'Externally changed workflow details.',
      updatedAt: '2026-08-25T20:00:00.000Z',
    })
    const client = {
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn().mockResolvedValueOnce(workflow).mockResolvedValue(externalWorkflow),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => harnesses),
      listRepositories: vi.fn(async () => repositories),
      startRun: vi.fn(),
    }
    render(
      <WorkflowWorkbench
        client={client}
        connectResourceEvents={(nextHandlers) => {
          handlers = nextHandlers
          return vi.fn()
        }}
      />,
    )

    await screen.findByText('Graph 1 nodes, 0 edges')
    fireEvent.click(screen.getByRole('button', { name: 'Configure workflow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit graph source' }))
    await act(async () =>
      handlers?.onEvent({
        sequence: 1,
        timestamp: '2026-08-25T20:00:00.000Z',
        change: 'CHANGED',
        resource: { type: 'WORKFLOW', workflowId: workflow.workflowId },
        revision: 'a'.repeat(64),
      }),
    )

    expect(screen.getByText(/changed outside Slopify/i)).toBeTruthy()
    expect(client.getWorkflow).toHaveBeenCalledTimes(1)
    expect(client.updateWorkflow).not.toHaveBeenCalled()

    await act(async () => handlers?.onReconcile())
    expect(client.getWorkflow).toHaveBeenNthCalledWith(2, workflow.workflowId, {
      preserveRevision: true,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close workflow configuration' }))
    await waitFor(() => expect(client.getWorkflow).toHaveBeenCalledTimes(3))
  })

  it('refreshes a clean workflow after an external graph change', async () => {
    let handlers: ResourceEventStreamHandlers | undefined
    const firstAgent = workflow.nodes[0]
    if (firstAgent === undefined) throw new Error('Expected an agent fixture')
    const externalWorkflow = WorkflowSchema.parse({
      ...workflow,
      nodes: [...workflow.nodes, { ...firstAgent, id: 'external-review' }],
      updatedAt: '2026-08-25T20:00:00.000Z',
    })
    const client = {
      deleteWorkflow: vi.fn(),
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn().mockResolvedValueOnce(workflow).mockResolvedValue(externalWorkflow),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => harnesses),
      listRepositories: vi.fn(async () => repositories),
      startRun: vi.fn(),
    }
    render(
      <WorkflowWorkbench
        client={client}
        connectResourceEvents={(nextHandlers) => {
          handlers = nextHandlers
          return vi.fn()
        }}
      />,
    )

    await screen.findByText('Graph 1 nodes, 0 edges')
    await act(async () =>
      handlers?.onEvent({
        sequence: 1,
        timestamp: '2026-08-25T20:00:00.000Z',
        change: 'CHANGED',
        resource: { type: 'WORKFLOW', workflowId: workflow.workflowId },
        revision: 'a'.repeat(64),
      }),
    )

    expect(await screen.findByText('Graph 2 nodes, 0 edges')).toBeTruthy()
    expect(client.listHarnesses).toHaveBeenCalledOnce()
  })
})
