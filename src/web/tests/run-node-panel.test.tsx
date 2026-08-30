// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentNodeSchema } from '@slopify/shared'

import { RunNodeDetailsPanel } from '../components/runs/run-node-details-panel'
import { RunNodePanel } from '../components/runs/run-node-panel'

const node = AgentNodeSchema.parse({
  type: 'agent',
  id: 'identify-agent',
  name: 'Alpha analyst',
  prompt: 'Analyze {{ topic }}.',
  harness: {
    harnessId: 'codex',
    modelId: 'gpt-5.6-sol',
    thinkingLevel: 'high',
  },
  timeoutSeconds: 300,
})

const completedExecution = {
  attemptId: 'attempt-01',
  completedAt: '2026-08-22T10:00:12.500Z',
  durationMs: 12_500,
  errorCode: null,
  errorMessage: null,
  outcome: 'completed',
  output: {
    summary: 'Implemented **session reopening** and verified the run.',
    data: {},
    evidence: [],
    durationMs: 12_500,
  },
  session: {
    sessionId: 'session-01',
    openCommand: 'codex resume session-01',
  },
  startedAt: '2026-08-22T10:00:00.000Z',
  nodeExecutionId: 'node-execution-01',
} as const

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RunNodePanel', () => {
  it('shows only captured configuration, the final result, and the session command', () => {
    render(<RunNodePanel execution={completedExecution} node={node} status="SUCCEEDED" />)

    const configuration = screen.getByLabelText('Configuration')
    expect(configuration.textContent).toContain('Codex')
    expect(configuration.textContent).toContain('gpt-5.6-sol')
    expect(configuration.textContent).toContain('high')
    expect(configuration.textContent).toContain('300 seconds')

    const result = screen.getByRole('region', { name: 'Agent result' })
    expect(result.textContent).toContain('Implemented session reopening and verified the run.')
    expect(result.querySelector('strong')?.textContent).toBe('session reopening')
    expect(screen.getByText('codex resume session-01')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Exchange' })).toBeNull()
    expect(screen.queryByText(node.prompt)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Work details' })).toBeNull()
  })

  it('copies the exact session command', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<RunNodePanel execution={completedExecution} node={node} status="SUCCEEDED" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy session command' }))

    expect(await screen.findByRole('button', { name: 'Session command copied' })).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith('codex resume session-01')
  })

  it('shows a compact waiting state without inventing a result or session', () => {
    render(
      <RunNodePanel
        execution={{ ...completedExecution, output: null, session: null }}
        node={node}
        status="RUNNING"
      />,
    )

    expect(screen.getByText('The final result will appear when this agent finishes.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Agent session' })).toBeNull()
    expect(screen.queryByText('Implemented session reopening and verified the run.')).toBeNull()
  })

  it('keeps the status on the title row and splits timing into two lines', () => {
    render(<RunNodeDetailsPanel execution={completedExecution} node={node} status="SUCCEEDED" />)

    const title = screen.getByRole('heading', { name: 'Alpha analyst' })
    const status = screen.getByText('Succeeded')
    expect(title.parentElement).toBe(status.parentElement)

    const timing = screen.getByLabelText('Execution timing')
    expect(timing.children).toHaveLength(2)
    expect(timing.children[0]?.textContent).toMatch(/^Started .+$/)
    expect(timing.children[1]?.textContent).toBe('Worked for 12.5 s')
  })
})
