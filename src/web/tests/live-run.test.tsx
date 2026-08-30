// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LiveRun } from '../components/runs/live-run'
import type { RunDetailResponse, StartRunResponse } from '../lib/api-client'
import { RunDetailResponseSchema } from '../lib/run-api-contract'
import { WORKFLOW_RUN_OUTCOMES_CHANGED_EVENT } from '../lib/workflow-run-outcome-events'
import { createAgentWorkflowFixture } from './fixtures/workflow'

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
    </div>
  ),
}))

const workflow = createAgentWorkflowFixture({
  createdAt: '2026-08-20T10:00:00Z',
  modelId: 'test-model',
  thinkingLevel: 'high',
})

const detail = RunDetailResponseSchema.parse({
  run: {
    schemaVersion: 1,
    runId: 'run-01',
    workflowId: workflow.workflowId,
    workflowSnapshot: workflow,
    variables: { task: 'Follow a live run' },
    status: 'RUNNING',
    transitionCount: 1,
    lastEventSequence: 0,
    createdAt: '2026-08-20T10:00:00Z',
    startedAt: '2026-08-20T10:00:01Z',
    completedAt: null,
    failureCode: null,
  },
  events: [],
  nodeExecutions: [
    {
      nodeExecutionId: 'node-execution-01',
      attemptId: 'attempt-01',
      nodeId: 'identify-agent',
      executionIndex: 0,
      status: 'RUNNING',
      output: null,
      outcome: null,
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-08-20T10:00:02Z',
      completedAt: null,
      durationMs: null,
      session: null,
    },
  ],
  repositories: [],
  repositoryWorkspaces: [],
})

const completedDetail = RunDetailResponseSchema.parse({
  ...detail,
  run: {
    ...detail.run,
    status: 'SUCCEEDED',
    completedAt: '2026-08-20T10:00:10Z',
  },
  nodeExecutions: [
    {
      ...detail.nodeExecutions[0],
      status: 'SUCCEEDED',
      outcome: 'completed',
      output: {
        summary: 'Implementation is complete.',
        data: {},
        evidence: [],
        durationMs: 7_000,
      },
      completedAt: '2026-08-20T10:00:09Z',
      durationMs: 7_000,
      session: {
        sessionId: 'session-01',
        openCommand: 'codex resume session-01',
      },
    },
  ],
})

beforeEach(() => {
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
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('LiveRun', () => {
  it('polls an active run every second and stops after the terminal snapshot', async () => {
    vi.useFakeTimers()
    const client = {
      getRun: vi
        .fn<() => Promise<RunDetailResponse>>()
        .mockResolvedValueOnce(detail)
        .mockResolvedValue(completedDetail),
      cancelRun: vi.fn(),
    }
    const outcomeChanged = vi.fn()
    window.addEventListener(WORKFLOW_RUN_OUTCOMES_CHANGED_EVENT, outcomeChanged)

    render(<LiveRun runId="run-01" client={client} />)
    await act(async () => undefined)

    expect(client.getRun).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Run status').textContent).toContain('Running')

    await act(async () => vi.advanceTimersByTimeAsync(1_000))

    expect(client.getRun).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('Run status').textContent).toContain('Succeeded')
    expect(screen.getByRole('region', { name: 'Workflow graph' }).textContent).toContain(
      '"identify-agent":"SUCCEEDED"',
    )
    expect(outcomeChanged).toHaveBeenCalledOnce()

    await act(async () => vi.advanceTimersByTimeAsync(3_000))
    expect(client.getRun).toHaveBeenCalledTimes(2)
    window.removeEventListener(WORKFLOW_RUN_OUTCOMES_CHANGED_EVENT, outcomeChanged)
  })

  it('keeps the last snapshot visible and retries after a polling failure', async () => {
    vi.useFakeTimers()
    const client = {
      getRun: vi
        .fn<() => Promise<RunDetailResponse>>()
        .mockResolvedValueOnce(detail)
        .mockRejectedValueOnce(new Error('Backend temporarily unavailable'))
        .mockResolvedValue(completedDetail),
      cancelRun: vi.fn(),
    }

    render(<LiveRun runId="run-01" client={client} />)
    await act(async () => undefined)
    await act(async () => vi.advanceTimersByTimeAsync(1_000))

    expect(screen.getByText('Run updates delayed')).toBeTruthy()
    expect(screen.getByText('Backend temporarily unavailable')).toBeTruthy()
    expect(screen.getByLabelText('Run status').textContent).toContain('Running')

    await act(async () => vi.advanceTimersByTimeAsync(1_000))

    expect(client.getRun).toHaveBeenCalledTimes(3)
    expect(screen.queryByText('Run updates delayed')).toBeNull()
    expect(screen.getByLabelText('Run status').textContent).toContain('Succeeded')
  })

  it('refreshes the detail immediately after a cancellation request', async () => {
    const cancelled = {
      schemaVersion: 1,
      runId: detail.run.runId,
      workflowId: detail.run.workflowId,
      status: 'CANCELLED',
      transitionCount: detail.run.transitionCount,
      lastEventSequence: detail.run.lastEventSequence,
      createdAt: detail.run.createdAt,
      startedAt: detail.run.startedAt,
      completedAt: '2026-08-20T10:00:10Z',
      failureCode: null,
    } satisfies StartRunResponse
    const cancelledDetail = {
      ...detail,
      run: { ...detail.run, ...cancelled },
    } as RunDetailResponse
    const client = {
      getRun: vi
        .fn<() => Promise<RunDetailResponse>>()
        .mockResolvedValueOnce(detail)
        .mockResolvedValue(cancelledDetail),
      cancelRun: vi.fn(async () => cancelled),
    }

    render(<LiveRun runId="run-01" client={client} />)
    expect(await screen.findByRole('button', { name: 'Cancel run' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))

    expect(await screen.findByText('Cancelled')).toBeTruthy()
    expect(client.cancelRun).toHaveBeenCalledWith('run-01', {
      reason: 'Cancelled from the workbench',
    })
    expect(client.getRun).toHaveBeenCalledTimes(2)
  })

  it('keeps captured-agent details beside the graph without loading a trace', async () => {
    const client = { getRun: vi.fn(async () => detail), cancelRun: vi.fn() }

    render(<LiveRun runId="run-01" client={client} />)

    const panel = await screen.findByRole('complementary', { name: 'Who are you?' })
    expect(panel.getAttribute('data-layout')).toBe('workspace')
    expect(panel.textContent).toContain('test-model')
    expect(screen.getByRole('region', { name: 'Workflow graph pane' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Workflow details pane' })).toBeTruthy()
  })
})
