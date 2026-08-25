// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentTraceSchema, RunEventSchema, type RunEvent } from '@slopify/contracts'

import { LiveRun } from '../components/runs/live-run'
import type { RunDetailResponse, StartRunResponse } from '../lib/api-client'
import type { RunEventSubscription, RunEventSubscriptionHandlers } from '../lib/event-stream'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const backgroundAction = vi.fn()

vi.mock('../components/workflow/workflow-canvas', () => ({
  WorkflowCanvas: ({
    onNodeSelect,
    recentRunStatuses,
    workflow,
  }: {
    onNodeSelect: (nodeId: string) => void
    recentRunStatuses: Readonly<Record<string, string>>
    workflow: { name: string }
  }) => (
    <div aria-label="Workflow graph" role="region">
      <p>
        {workflow.name}; statuses {JSON.stringify(recentRunStatuses)}
      </p>
      <button type="button" onClick={() => onNodeSelect('identify-agent')}>
        Inspect agent
      </button>
      <button type="button" onClick={backgroundAction}>
        Background action
      </button>
    </div>
  ),
}))

const workflow = createAgentWorkflowFixture({
  createdAt: '2026-08-20T10:00:00Z',
  modelId: 'test-model',
  thinkingLevel: 'high',
})

const events = RunEventSchema.array().parse([
  {
    runId: 'run-01',
    sequence: 1,
    timestamp: '2026-08-20T10:00:00Z',
    type: 'RUN_STARTED',
    data: {
      workflowId: workflow.workflowId,
    },
  },
  {
    runId: 'run-01',
    sequence: 2,
    timestamp: '2026-08-20T10:00:01Z',
    type: 'RUN_STATUS_CHANGED',
    data: { from: 'PENDING', to: 'RUNNING' },
  },
  {
    runId: 'run-01',
    sequence: 3,
    timestamp: '2026-08-20T10:00:02Z',
    type: 'NODE_STARTED',
    nodeId: 'identify-agent',
    data: {},
  },
])

const run = {
  runId: 'run-01',
  workflowId: workflow.workflowId,
  workflowSnapshot: workflow,
  variables: { task: 'Follow a live run' },
  status: 'RUNNING',
  transitionCount: 1,
  createdAt: '2026-08-20T10:00:00Z',
  startedAt: '2026-08-20T10:00:01Z',
  completedAt: null,
} as unknown as StartRunResponse

const detail = {
  run,
  events,
  nodeExecutions: [
    {
      nodeExecutionId: 'node-execution-01',
      attemptId: 'attempt-01',
      nodeId: 'identify-agent',
      executionIndex: 0,
      status: 'RUNNING',
      output: { data: { response: 'Implementation is in progress.' } },
      outcome: null,
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-08-20T10:00:02Z',
      completedAt: null,
      durationMs: null,
    },
  ],
  repositories: [],
  repositoryWorkspaces: [],
} as unknown as RunDetailResponse

const trace = AgentTraceSchema.parse({
  header: {
    version: 2,
    runId: 'run-01',
    nodeExecutionId: 'node-execution-01',
    attemptId: 'attempt-01',
    nodeId: 'identify-agent',
    createdAt: '2026-08-20T10:00:02Z',
    configuration: {
      harnessId: 'pi',
      harnessVersion: '0.84.2',
      model: 'test-model',
      thinkingLevel: 'high',
      renderedPrompt: "Who are you? What's your name?",
      workspaceRoot: '/Users/developer/.slopify/orchestrator/workspaces/run-01',
      primaryRepositoryId: 'repository-api',
      repositories: [
        {
          repositoryId: 'repository-api',
          name: 'API',
          provider: 'GITHUB',
          fullName: 'operator/api',
          workspacePath: '/Users/developer/.slopify/orchestrator/workspaces/run-01/repository-api',
          branchName: 'slopify/run-01',
          baseSha: '0123456789abcdef0123456789abcdef01234567',
          defaultBranch: 'main',
        },
      ],
      timeoutSeconds: 300,
    },
  },
  events: [
    {
      sequence: 1,
      timestamp: '2026-08-20T10:00:03Z',
      type: 'AGENT_TOOL_STARTED',
      data: { toolCallId: 'tool-01', toolName: 'read_file', input: { path: 'README.md' } },
    },
    {
      sequence: 2,
      timestamp: '2026-08-20T10:00:04Z',
      type: 'AGENT_TOOL_COMPLETED',
      data: {
        toolCallId: 'tool-01',
        toolName: 'read_file',
        status: 'succeeded',
        content: 'Read 42 lines',
      },
    },
  ],
  complete: false,
})

const createSubscription = () => {
  let handlers: RunEventSubscriptionHandlers | undefined
  const close = vi.fn()
  const subscription: RunEventSubscription = vi.fn((_url, nextHandlers) => {
    handlers = nextHandlers
    return close
  })
  return { close, subscription, handlers: () => handlers }
}

beforeEach(() => {
  backgroundAction.mockClear()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0)
    return 1
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false }),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('LiveRun', () => {
  it('shows run timing and status as canvas overlays while keeping live updates connected', async () => {
    const subscription = createSubscription()
    const client = { getRun: vi.fn(async () => detail), cancelRun: vi.fn() }

    render(<LiveRun runId="run-01" client={client} connect={subscription.subscription} />)

    const graph = await screen.findByRole('region', { name: 'Workflow graph' })
    const timing = screen.getByLabelText('Run timing')
    const status = screen.getByLabelText('Run status')

    expect(screen.queryByLabelText('Run summary')).toBeNull()
    expect(screen.queryByText('Run ID')).toBeNull()
    expect(timing.textContent).toMatch(/^Started .+ · Took .+$/)
    expect(timing.className).toContain('absolute')
    expect(timing.className).toContain('left-3')
    expect(status.textContent).toContain('Running')
    expect(status.className).toContain('absolute')
    expect(status.className).toContain('right-3')
    expect(graph.textContent).toContain('Who are you?')
    expect(subscription.subscription).toHaveBeenCalledWith(
      '/api/runs/run-01/events',
      expect.any(Object),
    )
  })

  it('reconciles a terminal snapshot immediately when live updates disconnect', async () => {
    const subscription = createSubscription()
    const completedEvents = RunEventSchema.array().parse([
      ...events,
      {
        runId: 'run-01',
        sequence: 4,
        timestamp: '2026-08-20T10:00:09Z',
        type: 'NODE_COMPLETED',
        nodeId: 'identify-agent',
        data: { outcome: 'completed', durationMs: 7_000 },
      },
      {
        runId: 'run-01',
        sequence: 5,
        timestamp: '2026-08-20T10:00:10Z',
        type: 'RUN_COMPLETED',
        data: { status: 'SUCCEEDED', durationMs: 9_000 },
      },
    ])
    const completedDetail = {
      ...detail,
      run: {
        ...run,
        status: 'SUCCEEDED',
        completedAt: '2026-08-20T10:00:10Z',
      },
      events: completedEvents,
      nodeExecutions: [
        {
          ...detail.nodeExecutions[0],
          status: 'SUCCEEDED',
          outcome: 'completed',
          output: { data: { response: 'Implementation is complete.' } },
          completedAt: '2026-08-20T10:00:09Z',
          durationMs: 7_000,
        },
      ],
    } as unknown as RunDetailResponse
    const client = {
      getRun: vi
        .fn<() => Promise<RunDetailResponse>>()
        .mockResolvedValueOnce(detail)
        .mockResolvedValue(completedDetail),
      cancelRun: vi.fn(),
    }

    render(<LiveRun runId="run-01" client={client} connect={subscription.subscription} />)
    const graph = await screen.findByRole('region', { name: 'Workflow graph' })
    await waitFor(() => expect(subscription.subscription).toHaveBeenCalledOnce())

    act(() => subscription.handlers()?.onDisconnect())

    await waitFor(() => expect(client.getRun).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Run status').textContent).toContain('Succeeded')
    expect(graph.textContent).toContain('"identify-agent":"SUCCEEDED"')
    expect(subscription.close).toHaveBeenCalledOnce()
  })

  it('ignores an older failed refresh after a newer reconnect refresh succeeds', async () => {
    const subscription = createSubscription()
    let rejectDisconnectedRefresh: (cause: Error) => void = () => undefined
    let resolveReconnectedRefresh: (next: RunDetailResponse) => void = () => undefined
    const disconnectedRefresh = new Promise<RunDetailResponse>((_resolve, reject) => {
      rejectDisconnectedRefresh = reject
    })
    const reconnectedRefresh = new Promise<RunDetailResponse>((resolve) => {
      resolveReconnectedRefresh = resolve
    })
    const client = {
      getRun: vi
        .fn<() => Promise<RunDetailResponse>>()
        .mockResolvedValueOnce(detail)
        .mockReturnValueOnce(disconnectedRefresh)
        .mockReturnValueOnce(reconnectedRefresh),
      cancelRun: vi.fn(),
    }

    render(<LiveRun runId="run-01" client={client} connect={subscription.subscription} />)
    await waitFor(() => expect(subscription.subscription).toHaveBeenCalledOnce())

    act(() => {
      subscription.handlers()?.onDisconnect()
      subscription.handlers()?.onOpen()
    })
    await waitFor(() => expect(client.getRun).toHaveBeenCalledTimes(3))

    await act(async () => resolveReconnectedRefresh(detail))
    await act(async () => rejectDisconnectedRefresh(new Error('Stale refresh failed')))

    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.queryByText('Stale refresh failed')).toBeNull()
  })

  it('applies an older terminal refresh after a newer reconnect refresh fails', async () => {
    const subscription = createSubscription()
    let resolveDisconnectedRefresh: (next: RunDetailResponse) => void = () => undefined
    let rejectReconnectedRefresh: (cause: Error) => void = () => undefined
    const disconnectedRefresh = new Promise<RunDetailResponse>((resolve) => {
      resolveDisconnectedRefresh = resolve
    })
    const reconnectedRefresh = new Promise<RunDetailResponse>((_resolve, reject) => {
      rejectReconnectedRefresh = reject
    })
    const succeededDetail = {
      ...detail,
      run: { ...run, status: 'SUCCEEDED', completedAt: '2026-08-20T10:00:10Z' },
      nodeExecutions: [
        {
          ...detail.nodeExecutions[0],
          status: 'SUCCEEDED',
          outcome: 'completed',
          completedAt: '2026-08-20T10:00:09Z',
          durationMs: 7_000,
        },
      ],
    } as unknown as RunDetailResponse
    const client = {
      getRun: vi
        .fn<() => Promise<RunDetailResponse>>()
        .mockResolvedValueOnce(detail)
        .mockReturnValueOnce(disconnectedRefresh)
        .mockReturnValueOnce(reconnectedRefresh),
      cancelRun: vi.fn(),
    }

    render(<LiveRun runId="run-01" client={client} connect={subscription.subscription} />)
    await waitFor(() => expect(subscription.subscription).toHaveBeenCalledOnce())

    act(() => {
      subscription.handlers()?.onDisconnect()
      subscription.handlers()?.onOpen()
    })
    await waitFor(() => expect(client.getRun).toHaveBeenCalledTimes(3))

    await act(async () => rejectReconnectedRefresh(new Error('Reconnect refresh failed')))
    expect(await screen.findByText('Reconnect refresh failed')).toBeTruthy()
    await act(async () => resolveDisconnectedRefresh(succeededDetail))

    await waitFor(() =>
      expect(screen.getByLabelText('Run status').textContent).toContain('Succeeded'),
    )
    expect(screen.getByText('Closed')).toBeTruthy()
    expect(screen.queryByText('Reconnect refresh failed')).toBeNull()
    expect(subscription.close).toHaveBeenCalledOnce()
  })

  it('keeps the captured-agent panel open during canvas interaction and closes only from its close button', async () => {
    const client = {
      getRun: vi.fn(async () => detail),
      getAgentTrace: vi.fn(async () => trace),
      cancelRun: vi.fn(),
    }
    render(<LiveRun runId="run-01" client={client} connect={createSubscription().subscription} />)

    const inspectAgent = await screen.findByRole('button', { name: 'Inspect agent' })
    inspectAgent.focus()
    fireEvent.click(inspectAgent)

    const panel = screen.getByRole('dialog', { name: 'Who are you?' })
    expect(panel.getAttribute('aria-modal')).toBe('false')
    expect(panel.getAttribute('data-layout')).toBe('floating')
    expect(panel.textContent).not.toContain('identify-agent')
    expect(screen.getByTestId('run-node-panel-shell').hasAttribute('aria-hidden')).toBe(false)
    const executionSummary = screen.getByLabelText('Execution summary')
    expect(executionSummary.textContent).toMatch(/^Started .+ - Took Not recorded$/)
    expect(executionSummary.textContent).not.toContain('Completed')
    expect(executionSummary.className).toContain('whitespace-nowrap')
    expect(panel.textContent).toContain('Running')
    expect(panel.textContent).toContain('test-model')
    await waitFor(() => expect(panel.textContent).toContain('read_file'))
    expect(screen.queryByRole('button', { name: /read_file/ })).toBeNull()
    expect(panel.textContent).not.toContain('Read 42 lines')
    expect(client.getAgentTrace).toHaveBeenCalledWith('run-01', 'node-execution-01', 'attempt-01')

    fireEvent.keyDown(document, { key: 'Escape' })
    const backgroundButton = screen.getByRole('button', { name: 'Background action' })
    fireEvent.pointerDown(backgroundButton)
    fireEvent.pointerMove(backgroundButton)
    fireEvent.pointerUp(backgroundButton)
    fireEvent.click(backgroundButton)

    expect(backgroundAction).toHaveBeenCalledOnce()
    expect(screen.getByTestId('run-node-panel-shell').getAttribute('data-open')).toBe('true')
    expect(screen.getByRole('dialog', { name: 'Who are you?' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close agent details' }))
    expect(document.activeElement).toBe(inspectAgent)
    const shell = screen.getByTestId('run-node-panel-shell')
    expect(shell.getAttribute('data-open')).toBe('false')
    fireEvent.transitionEnd(shell, {
      propertyName: 'translate',
    })
    expect(screen.queryByRole('dialog', { name: 'Who are you?' })).toBeNull()
  })

  it('reconciles streamed terminal status and cancels through the summary action', async () => {
    const subscription = createSubscription()
    const cancelled = {
      ...run,
      status: 'CANCELLED',
      completedAt: '2026-08-20T10:00:10Z',
    } as StartRunResponse
    const cancelledDetail = { ...detail, run: cancelled }
    const client = {
      getRun: vi
        .fn<() => Promise<RunDetailResponse>>()
        .mockResolvedValueOnce(detail)
        .mockResolvedValue(cancelledDetail),
      cancelRun: vi.fn(async () => cancelled),
    }

    render(<LiveRun runId="run-01" client={client} connect={subscription.subscription} />)
    await waitFor(() => expect(subscription.subscription).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))

    await waitFor(() => expect(client.cancelRun).toHaveBeenCalledWith('run-01', expect.any(Object)))
    expect(await screen.findByText('Cancelled')).toBeTruthy()
    expect(subscription.close).toHaveBeenCalled()

    act(() => {
      subscription.handlers()?.onEvent(
        RunEventSchema.parse({
          runId: 'run-01',
          sequence: 4,
          timestamp: '2026-08-20T10:00:10Z',
          type: 'RUN_COMPLETED',
          data: { status: 'CANCELLED', durationMs: 9_000 },
        }) as RunEvent,
      )
    })
  })
})
