// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentTraceSchema } from '@slopify/shared'

import { LiveRun } from '../components/runs/live-run'
import type { RunDetailResponse, StartRunResponse } from '../lib/api-client'
import type { RunEventSubscription, RunEventSubscriptionHandlers } from '../lib/event-stream'
import {
  ApiRunEventSchema,
  RunDetailResponseSchema,
  type ApiRunEvent,
} from '../lib/run-api-contract'
import { WORKFLOW_RUN_OUTCOMES_CHANGED_EVENT } from '../lib/workflow-run-outcome-events'
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
    workflow: { workflowId: string }
  }) => (
    <div aria-label="Workflow graph" role="region">
      <p>
        {workflow.workflowId}; statuses {JSON.stringify(recentRunStatuses)}
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

const events = ApiRunEventSchema.array().parse([
  {
    schemaVersion: 1,
    eventId: 'run-started',
    runId: 'run-01',
    sequence: 1,
    timestamp: '2026-08-20T10:00:00Z',
    type: 'RUN_STARTED',
    data: {},
  },
  {
    schemaVersion: 1,
    eventId: 'node-scheduled',
    runId: 'run-01',
    sequence: 2,
    timestamp: '2026-08-20T10:00:01Z',
    type: 'NODE_SCHEDULED',
    data: {
      nodeExecutionId: 'node-execution-01',
      attemptId: 'attempt-01',
      nodeId: 'identify-agent',
      executionIndex: 0,
      causationId: 'run-started',
    },
  },
  {
    schemaVersion: 1,
    eventId: 'node-started',
    runId: 'run-01',
    sequence: 3,
    timestamp: '2026-08-20T10:00:02Z',
    type: 'NODE_STARTED',
    data: { nodeExecutionId: 'node-execution-01', attemptId: 'attempt-01' },
  },
])

const detail = RunDetailResponseSchema.parse({
  run: {
    schemaVersion: 1,
    runId: 'run-01',
    workflowId: workflow.workflowId,
    workflowSnapshot: workflow,
    variables: { task: 'Follow a live run' },
    status: 'RUNNING',
    transitionCount: 1,
    lastEventSequence: 3,
    createdAt: '2026-08-20T10:00:00Z',
    startedAt: '2026-08-20T10:00:01Z',
    completedAt: null,
    failureCode: null,
  },
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
})
const run = detail.run

const trace = AgentTraceSchema.parse({
  header: {
    version: 4,
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
      workspaceRoot: '/Users/developer/.slopify/workflows/test-workflow/runs/run-01/workspaces',
      artifactsPath:
        '/Users/developer/.slopify/workflows/test-workflow/runs/run-01/artifacts/node-execution-01',
      primaryRepositoryId: 'repository-api',
      repositories: [
        {
          repositoryId: 'repository-api',
          name: 'API',
          provider: 'GITHUB',
          fullName: 'operator/api',
          workspacePath:
            '/Users/developer/.slopify/workflows/test-workflow/runs/run-01/workspaces/repository-api',
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
  it('keeps run timing and controls in one wrapping canvas overlay', async () => {
    const subscription = createSubscription()
    const client = { getRun: vi.fn(async () => detail), cancelRun: vi.fn() }

    const view = render(
      <LiveRun runId="run-01" client={client} connect={subscription.subscription} />,
    )

    const graph = await screen.findByRole('region', { name: 'Workflow graph' })
    const timing = screen.getByLabelText('Run timing')
    const status = screen.getByLabelText('Run status')
    const overlay = timing.parentElement
    const runSurfaceClasses = view.container.firstElementChild?.className.split(/\s+/) ?? []

    expect(screen.queryByLabelText('Run summary')).toBeNull()
    expect(screen.queryByText('Run ID')).toBeNull()
    expect(timing.textContent).toMatch(/^Started .+ · Took .+$/)
    expect(overlay).toBe(status.parentElement)
    expect(overlay?.className).toContain('absolute')
    expect(overlay?.className).toContain('inset-x-3')
    expect(overlay?.className).toContain('flex-wrap')
    expect(timing.className).not.toContain('absolute')
    expect(status.textContent).toContain('Running')
    expect(status.className).toContain('ml-auto')
    expect(status.className).not.toContain('absolute')
    expect(runSurfaceClasses).toContain('px-6')
    expect(runSurfaceClasses).toContain('pb-6')
    expect(runSurfaceClasses).not.toContain('p-6')
    expect(graph.textContent).toContain('test-workflow')
    expect(subscription.subscription).toHaveBeenCalledWith(
      '/api/runs/run-01/events',
      expect.any(Object),
    )
  })

  it('reconciles a terminal snapshot immediately when live updates disconnect', async () => {
    const subscription = createSubscription()
    const completedEvents = ApiRunEventSchema.array().parse([
      ...events,
      {
        schemaVersion: 1,
        eventId: 'node-succeeded',
        runId: 'run-01',
        sequence: 4,
        timestamp: '2026-08-20T10:00:09Z',
        type: 'NODE_SUCCEEDED',
        data: {
          nodeExecutionId: 'node-execution-01',
          attemptId: 'attempt-01',
          outcome: 'completed',
          output: { data: { response: 'Implementation is complete.' } },
          durationMs: 7_000,
        },
      },
      {
        schemaVersion: 1,
        eventId: 'run-succeeded',
        runId: 'run-01',
        sequence: 5,
        timestamp: '2026-08-20T10:00:10Z',
        type: 'RUN_SUCCEEDED',
        data: {},
      },
    ])
    const completedDetail = {
      ...detail,
      run: {
        ...run,
        status: 'SUCCEEDED',
        lastEventSequence: 5,
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
    const outcomeChanged = vi.fn()
    window.addEventListener(WORKFLOW_RUN_OUTCOMES_CHANGED_EVENT, outcomeChanged)

    render(<LiveRun runId="run-01" client={client} connect={subscription.subscription} />)
    const graph = await screen.findByRole('region', { name: 'Workflow graph' })
    await waitFor(() => expect(subscription.subscription).toHaveBeenCalledOnce())

    act(() => subscription.handlers()?.onDisconnect())

    await waitFor(() => expect(client.getRun).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Run status').textContent).toContain('Succeeded')
    expect(graph.textContent).toContain('"identify-agent":"SUCCEEDED"')
    expect(subscription.close).toHaveBeenCalledOnce()
    expect(outcomeChanged).toHaveBeenCalledOnce()
    window.removeEventListener(WORKFLOW_RUN_OUTCOMES_CHANGED_EVENT, outcomeChanged)
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

  it('keeps captured-agent details visible beside the graph during graph interaction', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-20T10:01:10Z'))
    const client = {
      getRun: vi.fn(async () => detail),
      getAgentTrace: vi.fn(async () => trace),
      cancelRun: vi.fn(),
    }
    render(<LiveRun runId="run-01" client={client} connect={createSubscription().subscription} />)

    const panel = await screen.findByRole('complementary', { name: 'Who are you?' })
    expect(panel.getAttribute('data-layout')).toBe('workspace')
    expect(panel.textContent).not.toContain('identify-agent')
    expect(screen.getByRole('region', { name: 'Workflow graph pane' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Workflow details pane' })).toBeTruthy()
    const executionSummary = screen.getByLabelText('Execution summary')
    expect(executionSummary.textContent).toMatch(/^Started .+ - Running for 1m 8s$/)
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
    expect(screen.getByRole('complementary', { name: 'Who are you?' })).toBeTruthy()
  })

  it('reconciles streamed terminal status and cancels through the summary action', async () => {
    const subscription = createSubscription()
    const cancelled = {
      schemaVersion: 1,
      runId: run.runId,
      workflowId: run.workflowId,
      status: 'CANCELLED',
      transitionCount: run.transitionCount,
      lastEventSequence: 4,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: '2026-08-20T10:00:10Z',
      failureCode: null,
    } satisfies StartRunResponse
    const cancelledDetail = { ...detail, run: { ...detail.run, ...cancelled } }
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
        ApiRunEventSchema.parse({
          schemaVersion: 1,
          eventId: 'run-cancelled',
          runId: 'run-01',
          sequence: 4,
          timestamp: '2026-08-20T10:00:10Z',
          type: 'RUN_CANCELLED',
          data: {},
        }) as ApiRunEvent,
      )
    })
  })
})
