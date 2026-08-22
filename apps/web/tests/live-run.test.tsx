// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentTraceSchema, RunEventSchema, type RunEvent } from '@slopify/contracts'
import { createPredefinedV1Workflow } from '@slopify/workflow-model'

import { LiveRun } from '../components/runs/live-run'
import type { RunDetailResponse, StartRunResponse } from '../lib/api-client'
import type { RunEventConnectionHandlers, RunEventConnector } from '../lib/event-stream'

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

const workflow = createPredefinedV1Workflow({
  createdAt: '2026-08-20T10:00:00Z',
  agentDefaults: {
    provider: 'test-provider',
    model: 'test-model',
    thinkingLevel: 'high',
  },
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
  {
    runId: 'run-01',
    sequence: 4,
    timestamp: '2026-08-20T10:00:03Z',
    type: 'NODE_OUTPUT',
    nodeId: 'identify-agent',
    data: { channel: 'agent', content: 'Tool started: read_file (tool-01)' },
  },
  {
    runId: 'run-01',
    sequence: 5,
    timestamp: '2026-08-20T10:00:04Z',
    type: 'NODE_OUTPUT',
    nodeId: 'identify-agent',
    data: {
      channel: 'agent',
      content: 'Tool succeeded: read_file (tool-01)\nRead 42 lines',
    },
  },
])

const run = {
  runId: 'run-01',
  workflowId: workflow.workflowId,
  workflowSnapshot: workflow,
  variables: { task: 'Follow a live run' },
  missingVariables: [],
  status: 'RUNNING',
  currentNodeId: 'identify-agent',
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
      inputReferences: {},
      output: { data: { response: 'Implementation is in progress.' } },
      outcome: null,
      errorCode: null,
      errorMessage: null,
      selectedTargetNodeId: null,
      startedAt: '2026-08-20T10:00:02Z',
      completedAt: null,
      durationMs: null,
    },
  ],
  outputChunks: [],
  artifacts: [],
} as unknown as RunDetailResponse

const trace = AgentTraceSchema.parse({
  header: {
    version: 1,
    runId: 'run-01',
    nodeExecutionId: 'node-execution-01',
    attemptId: 'attempt-01',
    nodeId: 'identify-agent',
    createdAt: '2026-08-20T10:00:02Z',
    configuration: {
      connectionId: 'test-provider-default',
      provider: 'openrouter',
      model: 'test-model',
      thinkingLevel: 'high',
      renderedPrompt: "Who are you? What's your name?",
      permissionProfile: 'workspace-write',
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

const createConnector = () => {
  let handlers: RunEventConnectionHandlers | undefined
  const close = vi.fn()
  const connector: RunEventConnector = vi.fn((_url, nextHandlers) => {
    handlers = nextHandlers
    return close
  })
  return { close, connector, handlers: () => handlers }
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
    const connection = createConnector()
    const client = { getRun: vi.fn(async () => detail), cancelRun: vi.fn() }

    render(<LiveRun runId="run-01" client={client} connect={connection.connector} />)

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
    expect(screen.queryByText('Repository selection')).toBeNull()
    expect(screen.queryByText('Delivery evidence')).toBeNull()
    expect(screen.queryByText('Run events')).toBeNull()
    expect(connection.connector).toHaveBeenCalledWith('/api/runs/run-01/events', expect.any(Object))
  })

  it('keeps the captured-job panel open during canvas interaction and closes only from its close button', async () => {
    const client = {
      getRun: vi.fn(async () => detail),
      getAgentTrace: vi.fn(async () => trace),
      cancelRun: vi.fn(),
    }
    render(<LiveRun runId="run-01" client={client} connect={createConnector().connector} />)

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

    fireEvent.click(screen.getByRole('button', { name: 'Close job details' }))
    expect(document.activeElement).toBe(inspectAgent)
    const shell = screen.getByTestId('run-node-panel-shell')
    expect(shell.getAttribute('data-open')).toBe('false')
    fireEvent.transitionEnd(shell, {
      propertyName: 'translate',
    })
    expect(screen.queryByRole('dialog', { name: 'Who are you?' })).toBeNull()
  })

  it('reconciles streamed terminal status and cancels through the summary action', async () => {
    const connection = createConnector()
    const cancelled = {
      ...run,
      status: 'CANCELLED',
      currentNodeId: null,
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

    render(<LiveRun runId="run-01" client={client} connect={connection.connector} />)
    await waitFor(() => expect(connection.connector).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))

    await waitFor(() => expect(client.cancelRun).toHaveBeenCalledWith('run-01', expect.any(Object)))
    expect(await screen.findByText('Cancelled')).toBeTruthy()
    expect(connection.close).toHaveBeenCalled()

    act(() => {
      connection.handlers()?.onEvent(
        RunEventSchema.parse({
          runId: 'run-01',
          sequence: 6,
          timestamp: '2026-08-20T10:00:10Z',
          type: 'RUN_COMPLETED',
          data: { status: 'CANCELLED', durationMs: 9_000 },
        }) as RunEvent,
      )
    })
  })
})
