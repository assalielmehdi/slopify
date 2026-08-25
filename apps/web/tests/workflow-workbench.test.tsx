// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkflowSchema, type Workflow } from '@slopify/workflow-model'
import {
  DeletionReceiptSchema,
  HarnessDescriptorSchema,
  RepositorySchema,
} from '@slopify/contracts'

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

vi.mock('../components/workflow/workflow-config-drawer', () => ({
  WorkflowConfigDrawer: ({
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
    <aside aria-label="Workflow configuration">
      {conflict === undefined ? null : <p>{conflict}</p>}
      <button onClick={() => onDirtyChange?.(true)}>Edit graph source</button>
      <button onClick={onClose}>Close workflow configuration</button>
      <button onClick={() => void onDelete()}>Delete workflow</button>
      <button
        onClick={() =>
          void onSubmit({
            ...value,
            name: 'renamed-workflow',
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

vi.mock('../components/runs/start-run-drawer', () => ({
  StartRunDrawer: ({ onClose }: { onClose: () => void }) => (
    <aside aria-label="Run">
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
      name: 'Release workflow',
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
      name: 'Release workflow',
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

  it('loads a read-only graph workspace with run and configuration drawers', async () => {
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
    expect(client.getWorkflow).toHaveBeenCalledWith('default-workflow')
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(screen.getByRole('complementary', { name: 'Run' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Workflow graph' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: workflow.name })).toBeNull()
    expect(screen.queryByText(workflow.description)).toBeNull()
    expect(screen.queryByText(/version/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Add agent/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Connect agents/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Select agent' }))
    expect(screen.queryByRole('complementary', { name: 'Edit agent' })).toBeNull()
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
    expect(screen.getByRole('complementary', { name: 'Workflow configuration' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save workflow configuration' }))

    await waitFor(() =>
      expect(updateWorkflow).toHaveBeenCalledWith(
        workflow.workflowId,
        expect.objectContaining({
          name: 'renamed-workflow',
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

  it('deletes the current workflow and selects the next remaining workflow', async () => {
    const remainingWorkflow = WorkflowSchema.parse({
      ...workflow,
      workflowId: 'remaining-workflow',
      name: 'remaining-workflow',
    })
    const deleteWorkflow = vi.fn(async () =>
      DeletionReceiptSchema.parse({
        deletionId: 'deletion-workflow-01',
        subject: { type: 'WORKFLOW', id: workflow.workflowId },
        deletedAt: '2026-08-25T10:00:00Z',
        undoExpiresAt: '2026-08-25T10:00:10Z',
      }),
    )
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
    expect(screen.queryByRole('complementary', { name: 'Edit agent' })).toBeNull()
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
      name: 'Externally changed workflow',
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
  })
})
