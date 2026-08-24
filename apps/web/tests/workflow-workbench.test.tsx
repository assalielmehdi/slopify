// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkflowSchema, type Workflow } from '@slopify/workflow-model'
import { HarnessDescriptorSchema, ProjectSchema } from '@slopify/contracts'

import { WorkflowWorkbench } from '../components/workflow/workflow-workbench'
import { toast } from '../lib/toast'
import { createAgentWorkflowFixture } from './fixtures/workflow'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

vi.mock('../components/workflow/workflow-canvas', () => ({
  WorkflowCanvas: ({
    workflow,
    onAddAgent,
    onNodeSelect,
    onConnect,
    onConfigure,
    onRun,
    addAgentDisabledReason,
    runDisabledReason,
    runnable,
  }: {
    workflow: { nodes: readonly unknown[]; edges: readonly unknown[] }
    onAddAgent: (sourceNodeId?: string) => void
    onNodeSelect: (nodeId: string) => void
    onConnect: (source: string, target: string) => void
    onConfigure: () => void
    onRun: () => void
    addAgentDisabledReason?: string
    runDisabledReason?: string
    runnable: boolean
  }) => (
    <div aria-label="Workflow graph" role="region">
      Graph {workflow.nodes.length} nodes, {workflow.edges.length} edges
      <button
        disabled={addAgentDisabledReason !== undefined}
        title={addAgentDisabledReason}
        onClick={() => onAddAgent('identify-agent')}
      >
        Add connected agent
      </button>
      <button
        disabled={addAgentDisabledReason !== undefined}
        title={addAgentDisabledReason}
        onClick={() => onAddAgent()}
      >
        Add first agent
      </button>
      <button onClick={() => onNodeSelect('identify-agent')}>Select agent</button>
      <button onClick={() => onNodeSelect('review-agent')}>Select middle agent</button>
      <button onClick={() => onConnect('identify-agent', 'review-agent')}>Connect agents</button>
      <button onClick={onConfigure}>Configure workflow</button>
      <button disabled={!runnable} title={runDisabledReason} onClick={onRun}>
        Run
      </button>
    </div>
  ),
}))

vi.mock('../components/workflow/workflow-config-drawer', () => ({
  WorkflowConfigDrawer: ({ onSubmit }: { onSubmit: (value: unknown) => Promise<boolean> }) => (
    <aside aria-label="Workflow configuration">
      <button
        onClick={() =>
          void onSubmit({
            projectIds: ['project-api'],
            primaryProjectId: 'project-api',
            variables: ['topic', 'release'],
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

vi.mock('../components/workflow/agent-drawer', () => ({
  createAgentId: (_name: string, existingNodeIds: ReadonlySet<string>) =>
    existingNodeIds.has('new-agent') ? 'new-agent-2' : 'new-agent',
  AgentDrawer: ({
    mode,
    onDelete,
    onSubmit,
  }: {
    mode: { kind: string }
    onDelete: () => Promise<boolean>
    onSubmit: (value: unknown) => Promise<boolean>
  }) => (
    <aside aria-label={mode.kind === 'create' ? 'Add agent' : 'Edit agent'}>
      {mode.kind === 'edit' ? <button onClick={() => void onDelete()}>Delete agent</button> : null}
      <button
        onClick={() =>
          void onSubmit({
            id: mode.kind === 'create' ? 'review-agent' : 'identify-agent',
            name: 'Review agent',
            prompt: 'Review {{ topic }}',
            harness: {
              harnessId: 'pi',
              modelId: 'openai/gpt-5.6-luna',
              thinkingLevel: 'high',
            },
          })
        }
      >
        Submit agent
      </button>
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
    projectIds: ['project-api'],
    primaryProjectId: 'project-api',
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('WorkflowWorkbench', () => {
  it('loads only the graph workspace with a floating run action and graph-native drawers', async () => {
    const client = {
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn(async () => workflow),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => harnesses),
      listProjects: vi.fn(async () => projects),
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
    expect(screen.queryByRole('button', { name: 'Add agent' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add connected agent' }))
    expect(screen.getByRole('complementary', { name: 'Add agent' })).toBeTruthy()
    expect(screen.getByText('Graph 2 nodes, 1 edges')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Select agent' }))
    expect(screen.getByRole('complementary', { name: 'Edit agent' })).toBeTruthy()
  })

  it('opens workflow configuration beside the run action and persists it on the workflow', async () => {
    const updateWorkflow = vi.fn(async (_workflowId, next) => next)
    const client = {
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn(async () => workflow),
      updateWorkflow,
      listHarnesses: vi.fn(async () => harnesses),
      listProjects: vi.fn(async () => projects),
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
          configuration: {
            projectIds: ['project-api'],
            primaryProjectId: 'project-api',
            variables: ['topic', 'release'],
          },
        }),
      ),
    )
  })

  it('persists a created agent and a directed completed edge', async () => {
    const updateWorkflow = vi.fn(async (_workflowId, next) => next)
    const client = {
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn(async () => workflow),
      updateWorkflow,
      listHarnesses: vi.fn(async () => harnesses),
      listProjects: vi.fn(async () => projects),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)
    await screen.findByText('Graph 1 nodes, 0 edges')
    fireEvent.click(screen.getByRole('button', { name: 'Add connected agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit agent' }))

    expect(updateWorkflow).toHaveBeenLastCalledWith(
      workflow.workflowId,
      expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({ id: 'review-agent' })]),
        edges: [
          expect.objectContaining({
            sourceNodeId: 'identify-agent',
            targetNodeId: 'review-agent',
            outcome: 'completed',
          }),
        ],
      }),
    )
  })

  it('deletes an agent with its incident edges and offers undo', async () => {
    const firstAgent = workflow.nodes[0]
    if (firstAgent === undefined) throw new Error('Expected an agent fixture')
    const connectedWorkflow = WorkflowSchema.parse({
      ...workflow,
      nodes: [
        firstAgent,
        {
          ...firstAgent,
          id: 'review-agent',
          name: 'Review agent',
        },
      ],
      edges: [
        {
          sourceNodeId: firstAgent.id,
          targetNodeId: 'review-agent',
          outcome: 'completed',
          label: 'Completed',
        },
      ],
    })
    const updateWorkflow = vi.fn(async (_workflowId, next) => next)
    const addToast = vi.spyOn(toast, 'add')
    const closeToast = vi.spyOn(toast, 'close')
    const client = {
      listWorkflows: vi.fn(async () => [connectedWorkflow]),
      getWorkflow: vi.fn(async () => connectedWorkflow),
      updateWorkflow,
      listHarnesses: vi.fn(async () => harnesses),
      listProjects: vi.fn(async () => projects),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)
    await screen.findByText('Graph 2 nodes, 1 edges')
    fireEvent.click(screen.getByRole('button', { name: 'Select agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete agent' }))

    await waitFor(() =>
      expect(updateWorkflow).toHaveBeenCalledWith(
        connectedWorkflow.workflowId,
        expect.objectContaining({
          nodes: [expect.objectContaining({ id: 'review-agent' })],
          edges: [],
          startNodeId: 'review-agent',
        }),
      ),
    )
    expect(await screen.findByText('Graph 1 nodes, 0 edges')).toBeTruthy()
    const deletionToast = addToast.mock.calls.find(
      ([options]) => options.title === 'Agent deleted',
    )?.[0]
    expect(deletionToast).toMatchObject({
      title: 'Agent deleted',
      description: `${firstAgent.name} was removed from the workflow.`,
      type: 'info',
      actionProps: { children: 'Undo' },
    })

    await act(async () => {
      await deletionToast?.actionProps?.onClick?.({ preventDefault: vi.fn() } as never)
    })
    deletionToast?.onRemove?.()

    await waitFor(() =>
      expect(updateWorkflow).toHaveBeenLastCalledWith(
        connectedWorkflow.workflowId,
        connectedWorkflow,
      ),
    )
    expect(closeToast).toHaveBeenCalledWith(expect.any(String))
    expect(await screen.findByText('Graph 2 nodes, 1 edges')).toBeTruthy()
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Agent restored', type: 'success' }),
    )
  })

  it('removes a deleted agent and all of its incident routing edges', async () => {
    const firstAgent = workflow.nodes[0]
    if (firstAgent === undefined) throw new Error('Expected an agent fixture')
    const connectedWorkflow = WorkflowSchema.parse({
      ...workflow,
      nodes: [
        firstAgent,
        { ...firstAgent, id: 'review-agent', name: 'Review agent' },
        { ...firstAgent, id: 'publish-agent', name: 'Publish agent' },
      ],
      edges: [
        {
          sourceNodeId: firstAgent.id,
          targetNodeId: 'review-agent',
          outcome: 'completed',
          label: 'Completed',
        },
        {
          sourceNodeId: 'review-agent',
          targetNodeId: 'publish-agent',
          outcome: 'completed',
          label: 'Completed',
        },
      ],
    })
    const updateWorkflow = vi.fn(async (_workflowId, next) => next)
    const client = {
      listWorkflows: vi.fn(async () => [connectedWorkflow]),
      getWorkflow: vi.fn(async () => connectedWorkflow),
      updateWorkflow,
      listHarnesses: vi.fn(async () => harnesses),
      listProjects: vi.fn(async () => projects),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)
    await screen.findByText('Graph 3 nodes, 2 edges')
    fireEvent.click(screen.getByRole('button', { name: 'Select middle agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete agent' }))

    await waitFor(() =>
      expect(updateWorkflow).toHaveBeenCalledWith(
        connectedWorkflow.workflowId,
        expect.objectContaining({
          nodes: [
            expect.objectContaining({ id: firstAgent.id }),
            expect.objectContaining({ id: 'publish-agent' }),
          ],
          edges: [],
        }),
      ),
    )
  })

  it('shows a structured error state when no workflow is available', async () => {
    const client = {
      listWorkflows: vi.fn(async () => []),
      getWorkflow: vi.fn(),
      updateWorkflow: vi.fn(),
      listHarnesses: vi.fn(async () => harnesses),
      listProjects: vi.fn(async () => projects),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    expect((await screen.findByRole('alert')).textContent).toContain('No workflows available')
  })

  it('renders a zero-node workflow as an empty non-runnable canvas', async () => {
    const emptyWorkflow = {
      ...workflow,
      startNodeId: null,
      nodes: [],
      edges: [],
    } as unknown as Workflow
    const client = {
      listWorkflows: vi.fn(async () => [emptyWorkflow]),
      getWorkflow: vi.fn(async () => emptyWorkflow),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => harnesses),
      listProjects: vi.fn(async () => projects),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    expect(await screen.findByText('Graph 0 nodes, 0 edges')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Add first agent' }))
    expect(screen.getByRole('complementary', { name: 'Add agent' })).toBeTruthy()
  })

  it('keeps existing agents inspectable but blocks adding and running without Pi', async () => {
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
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn(async () => workflow),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => unavailableHarnesses),
      listProjects: vi.fn(async () => projects),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    await screen.findByText('Graph 1 nodes, 0 edges')
    const add = screen.getByRole('button', { name: 'Add connected agent' })
    expect((add as HTMLButtonElement).disabled).toBe(true)
    expect(add.getAttribute('title')).toContain('Pi is unavailable')
    expect(add.getAttribute('title')).toContain('Open Harnesses')
    const run = screen.getByRole('button', { name: 'Run' })
    expect((run as HTMLButtonElement).disabled).toBe(true)
    expect(run.getAttribute('title')).toContain('Pi is unavailable')

    fireEvent.click(screen.getByRole('button', { name: 'Select agent' }))
    expect(screen.getByRole('complementary', { name: 'Edit agent' })).toBeTruthy()
  })

  it('blocks running when a configured project is missing from the host catalog', async () => {
    const client = {
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn(async () => workflow),
      updateWorkflow: vi.fn(async (_workflowId, next) => next),
      listHarnesses: vi.fn(async () => harnesses),
      listProjects: vi.fn(async () => []),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    await screen.findByText('Graph 1 nodes, 0 edges')
    const run = screen.getByRole('button', { name: 'Run' })
    expect((run as HTMLButtonElement).disabled).toBe(true)
    expect(run.getAttribute('title')).toContain('Every selected project must be available')
  })
})
