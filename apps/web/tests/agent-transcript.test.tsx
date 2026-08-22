// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AgentTraceEventSchema, type AgentTraceEvent } from '@slopify/contracts'

import { AgentTranscript } from '../components/runs/agent-transcript'

const traceEvent = (
  sequence: number,
  type: AgentTraceEvent['type'],
  data: AgentTraceEvent['data'],
): AgentTraceEvent =>
  AgentTraceEventSchema.parse({
    sequence,
    timestamp: `2026-08-22T10:00:0${sequence}.000Z`,
    type,
    data,
  })

afterEach(cleanup)

describe('AgentTranscript', () => {
  it('renders reasoning and complete tool input, progress, and output from the trace', () => {
    render(
      <AgentTranscript
        prompt="Implement the requested change."
        result={undefined}
        streaming={false}
        events={[
          traceEvent(1, 'AGENT_REASONING', { content: 'I should inspect the source first.' }),
          traceEvent(2, 'AGENT_TOOL_STARTED', {
            toolCallId: 'tool-01',
            toolName: 'read_file',
            input: { path: 'apps/web/app/page.tsx' },
          }),
          traceEvent(3, 'AGENT_TOOL_UPDATED', {
            toolCallId: 'tool-01',
            content: 'Reading 42 lines',
          }),
          traceEvent(4, 'AGENT_TOOL_COMPLETED', {
            toolCallId: 'tool-01',
            toolName: 'read_file',
            status: 'succeeded',
            content: 'Read 42 lines',
          }),
          traceEvent(5, 'AGENT_MESSAGE', { content: 'The implementation is complete.' }),
        ]}
      />,
    )

    expect(screen.getByText('Model reasoning')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Model reasoning' }))
    expect(screen.getByText('I should inspect the source first.')).toBeTruthy()
    expect(screen.getByText('read_file')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /read_file/ }))
    expect(screen.getByText(/apps\/web\/app\/page.tsx/)).toBeTruthy()
    expect(screen.getByText('Reading 42 lines')).toBeTruthy()
    expect(screen.getByText('Read 42 lines')).toBeTruthy()
    expect(screen.getByText('The implementation is complete.')).toBeTruthy()
    expect(screen.getByText('Agent message updated')).toBeTruthy()
  })

  it('shows a truthful empty state when no trace or result was recorded', () => {
    render(
      <AgentTranscript
        prompt="Implement the requested change."
        streaming={false}
        events={[]}
        result={undefined}
      />,
    )

    expect(screen.getByText('No trace was recorded.')).toBeTruthy()
  })

  it('replaces the live announcement node for consecutive events of the same type', () => {
    const firstEvent = traceEvent(1, 'AGENT_REASONING', { content: 'First thought.' })
    const secondEvent = traceEvent(2, 'AGENT_REASONING', { content: 'Second thought.' })
    const { container, rerender } = render(
      <AgentTranscript
        prompt="Implement the requested change."
        streaming
        events={[firstEvent]}
        result={undefined}
      />,
    )
    const firstAnnouncement = container.querySelector('[aria-live] > span')

    rerender(
      <AgentTranscript
        prompt="Implement the requested change."
        streaming
        events={[firstEvent, secondEvent]}
        result={undefined}
      />,
    )

    const secondAnnouncement = container.querySelector('[aria-live] > span')
    expect(secondAnnouncement?.textContent).toBe('Model reasoning updated')
    expect(secondAnnouncement).not.toBe(firstAnnouncement)
  })
})
