// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPredefinedV1Workflow } from '@loop/workflow-model'

import { LiveRun } from '../components/runs/live-run'
import type { RunDetailResponse } from '../lib/api-client'
import type { RunEventConnector } from '../lib/event-stream'

vi.mock('../components/workflow/workflow-canvas', () => ({
  WorkflowCanvas: ({
    onNodeSelect,
    workflow,
  }: {
    onNodeSelect: (nodeId: string) => void
    workflow: { name: string }
  }) => (
    <div aria-label="Workflow graph" role="region">
      <p>Captured graph {workflow.name}</p>
      <button type="button" onClick={() => onNodeSelect('identify-agent')}>
        Inspect captured agent
      </button>
    </div>
  ),
}))

const workflow = createPredefinedV1Workflow({
  createdAt: '2026-07-01T10:00:00Z',
  agentDefaults: {
    provider: 'historical-provider',
    model: 'historical-model',
    thinkingLevel: 'xhigh',
  },
})

const detail = {
  run: {
    runId: 'run-historical',
    workflowId: workflow.workflowId,
    workflowSnapshot: workflow,
    variables: { task: 'PROJ-9' },
    missingVariables: [],
    status: 'SUCCEEDED',
    currentNodeId: null,
    transitionCount: 10,
    createdAt: '2026-07-01T10:00:00Z',
    startedAt: '2026-07-01T10:00:01Z',
    completedAt: '2026-07-01T10:05:01Z',
  },
  events: [],
  nodeExecutions: [
    {
      nodeExecutionId: 'node-execution-01',
      attemptId: 'attempt-01',
      nodeId: 'identify-agent',
      executionIndex: 0,
      status: 'SUCCEEDED',
      inputReferences: {},
      output: { data: { response: 'Captured response from July.' } },
      outcome: 'implemented',
      errorCode: null,
      errorMessage: null,
      selectedTargetNodeId: 'verify',
      startedAt: '2026-07-01T10:01:00Z',
      completedAt: '2026-07-01T10:02:00Z',
      durationMs: 60_000,
    },
  ],
  outputChunks: [],
  artifacts: [],
} as unknown as RunDetailResponse

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0)
    return 1
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false }),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('historical run', () => {
  it('uses the captured workflow and node configuration without opening a live stream', async () => {
    const connector: RunEventConnector = vi.fn()
    const client = { getRun: vi.fn(async () => detail), cancelRun: vi.fn() }

    render(<LiveRun runId="run-historical" client={client} connect={connector} />)

    expect(await screen.findByText('Captured graph Who are you?')).toBeTruthy()
    expect(connector).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect captured agent' }))

    const panel = screen.getByRole('dialog', { name: 'Who are you?' })
    expect(panel.textContent).toContain('historical-provider-default')
    expect(panel.textContent).toContain('historical-model')
    expect(panel.textContent).toContain('xhigh')
    expect(panel.textContent).toContain('Captured response from July.')
  })
})
