// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RunEventSchema, type RunEvent } from '@loop/contracts'
import { createPredefinedV1Workflow } from '@loop/workflow-model'

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
  it('shows only the summary and captured workflow canvas while keeping live updates connected', async () => {
    const connection = createConnector()
    const client = { getRun: vi.fn(async () => detail), cancelRun: vi.fn() }

    render(<LiveRun runId="run-01" client={client} connect={connection.connector} />)

    const summary = await screen.findByLabelText('Run summary')
    expect(summary.textContent).toContain('run-01')
    expect(summary.textContent).toContain('Running')
    expect(screen.getByRole('region', { name: 'Workflow graph' }).textContent).toContain(
      'Who are you?',
    )
    expect(screen.queryByText('Repository selection')).toBeNull()
    expect(screen.queryByText('Delivery evidence')).toBeNull()
    expect(screen.queryByText('Run events')).toBeNull()
    expect(connection.connector).toHaveBeenCalledWith('/api/runs/run-01/events', expect.any(Object))
  })

  it('opens a non-modal floating captured-job panel and closes without blocking background actions', async () => {
    const client = { getRun: vi.fn(async () => detail), cancelRun: vi.fn() }
    render(<LiveRun runId="run-01" client={client} connect={createConnector().connector} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Inspect agent' }))

    const panel = screen.getByRole('dialog', { name: 'Who are you?' })
    expect(panel.getAttribute('aria-modal')).toBe('false')
    expect(panel.getAttribute('data-layout')).toBe('floating')
    expect(panel.textContent).toContain('test-provider-default')
    expect(panel.textContent).toContain('test-model')
    expect(panel.textContent).toContain('read_file')
    expect(panel.textContent).toContain('Read 42 lines')

    const backgroundButton = screen.getByRole('button', { name: 'Background action' })
    fireEvent.pointerDown(backgroundButton)
    fireEvent.click(backgroundButton)

    expect(backgroundAction).toHaveBeenCalledOnce()
    expect(screen.getByTestId('run-node-panel-shell').getAttribute('data-open')).toBe('false')
    fireEvent.transitionEnd(screen.getByTestId('run-node-panel-shell'), {
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
