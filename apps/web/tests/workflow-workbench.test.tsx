// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPredefinedV1Workflow, WorkflowSchema, type Workflow } from '@slopify/workflow-model'

import { WorkflowWorkbench } from '../components/workflow/workflow-workbench'
import { toast } from '../components/ui/toast'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

vi.mock('../components/workflow/workflow-canvas', () => ({
  WorkflowCanvas: ({
    workflow,
    onAddAgent,
    onNodeSelect,
    onConnect,
    onRun,
    runnable,
  }: {
    workflow: { nodes: readonly unknown[]; edges: readonly unknown[] }
    onAddAgent: (sourceNodeId?: string) => void
    onNodeSelect: (nodeId: string) => void
    onConnect: (source: string, target: string) => void
    onRun: () => void
    runnable: boolean
  }) => (
    <div aria-label="Workflow graph" role="region">
      Graph {workflow.nodes.length} nodes, {workflow.edges.length} edges
      <button onClick={() => onAddAgent('identify-agent')}>Add connected agent</button>
      <button onClick={() => onAddAgent()}>Add first agent</button>
      <button onClick={() => onNodeSelect('identify-agent')}>Select agent</button>
      <button onClick={() => onNodeSelect('review-agent')}>Select middle agent</button>
      <button onClick={() => onConnect('identify-agent', 'review-agent')}>Connect agents</button>
      <button disabled={!runnable} onClick={onRun}>
        Run
      </button>
    </div>
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
            inference: {
              connectionId: 'chatgpt-default',
              modelId: 'gpt-5.6-luna',
              thinkingLevel: 'high',
            },
            connectorIds: [],
            skillSnapshotRefs: [],
          })
        }
      >
        Submit agent
      </button>
    </aside>
  ),
}))

const workflow = createPredefinedV1Workflow({
  createdAt: '2026-08-18T12:00:00Z',
  agentDefaults: {
    provider: 'test-provider',
    model: 'test-model',
    thinkingLevel: 'high',
  },
})
const catalog = [workflow] as const

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
      listSkills: vi.fn(async () => []),
      listConnections: vi.fn(async () => ({ catalog: [], connections: [] })),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    expect(await screen.findByText('Graph 1 nodes, 0 edges')).toBeTruthy()
    expect(client.getWorkflow).toHaveBeenCalledWith('delivery-workflow')
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

  it('persists a created agent and a directed completed edge', async () => {
    const updateWorkflow = vi.fn(async (_workflowId, next) => next)
    const client = {
      listWorkflows: vi.fn(async () => catalog),
      getWorkflow: vi.fn(async () => workflow),
      updateWorkflow,
      listSkills: vi.fn(async () => []),
      listConnections: vi.fn(async () => ({ catalog: [], connections: [] })),
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
    if (firstAgent?.type !== 'agent') throw new Error('Expected an agent fixture')
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
      listSkills: vi.fn(async () => []),
      listConnections: vi.fn(async () => ({ catalog: [], connections: [] })),
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

  it('reconnects the predecessor and successor when deleting a middle agent', async () => {
    const firstAgent = workflow.nodes[0]
    if (firstAgent?.type !== 'agent') throw new Error('Expected an agent fixture')
    const linearWorkflow = WorkflowSchema.parse({
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
      listWorkflows: vi.fn(async () => [linearWorkflow]),
      getWorkflow: vi.fn(async () => linearWorkflow),
      updateWorkflow,
      listSkills: vi.fn(async () => []),
      listConnections: vi.fn(async () => ({ catalog: [], connections: [] })),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)
    await screen.findByText('Graph 3 nodes, 2 edges')
    fireEvent.click(screen.getByRole('button', { name: 'Select middle agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete agent' }))

    await waitFor(() =>
      expect(updateWorkflow).toHaveBeenCalledWith(
        linearWorkflow.workflowId,
        expect.objectContaining({
          nodes: [
            expect.objectContaining({ id: firstAgent.id }),
            expect.objectContaining({ id: 'publish-agent' }),
          ],
          edges: [
            expect.objectContaining({
              sourceNodeId: firstAgent.id,
              targetNodeId: 'publish-agent',
            }),
          ],
        }),
      ),
    )
  })

  it('shows a structured error state when no workflow is available', async () => {
    const client = {
      listWorkflows: vi.fn(async () => []),
      getWorkflow: vi.fn(),
      updateWorkflow: vi.fn(),
      listSkills: vi.fn(async () => []),
      listConnections: vi.fn(async () => ({ catalog: [], connections: [] })),
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
      listSkills: vi.fn(async () => []),
      listConnections: vi.fn(async () => ({ catalog: [], connections: [] })),
      startRun: vi.fn(),
    }

    render(<WorkflowWorkbench client={client} />)

    expect(await screen.findByText('Graph 0 nodes, 0 edges')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Add first agent' }))
    expect(screen.getByRole('complementary', { name: 'Add agent' })).toBeTruthy()
  })
})
