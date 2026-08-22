// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
  it('renders only reasoning, completed tool calls, and the final result as separate bubbles', () => {
    const { container } = render(
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
          traceEvent(5, 'AGENT_MESSAGE', { content: 'Intermediate assistant text.' }),
          traceEvent(6, 'AGENT_RESULT', {
            result: {
              outcome: 'completed',
              summary: 'The implementation is complete.',
              data: {},
              artifacts: [],
              evidence: [],
            },
            usage: {
              inputTokens: 10,
              outputTokens: 20,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
            durationMs: 1_250,
          }),
        ]}
      />,
    )

    const reasoning = screen.getByText('I should inspect the source first.')
    expect(reasoning.closest('[data-message-kind="reasoning"]')).toBeTruthy()
    expect(screen.getByText('Reasoning')).toBeTruthy()
    const toolCall = screen.getByText('read_file').closest('[data-message-kind="tool"]')
    expect(toolCall).toBeTruthy()
    expect(toolCall?.getAttribute('data-variant')).toBe('muted')
    expect(screen.queryByRole('button', { name: /read_file/ })).toBeNull()
    expect(screen.queryByText(/apps\/web\/app\/page.tsx/)).toBeNull()
    expect(screen.queryByText('Reading 42 lines')).toBeNull()
    expect(screen.queryByText('Read 42 lines')).toBeNull()
    const response = screen.getByText('The implementation is complete.')
    expect(response.closest('[data-message-kind="result"]')).toBeTruthy()
    expect(screen.queryByText('Intermediate assistant text.')).toBeNull()
    expect(container.querySelectorAll('[data-message-kind]')).toHaveLength(3)
  })

  it('renders Markdown in prompt and results while reasoning remains plain text', () => {
    const { container } = render(
      <AgentTranscript
        prompt="Read the **task** and visit [ClickUp](https://app.clickup.com)."
        result={undefined}
        streaming={false}
        events={[
          traceEvent(1, 'AGENT_REASONING', {
            content: '**Planning JSON retrieval** with `curl`',
          }),
          traceEvent(2, 'AGENT_REASONING', {
            content: '**Planning comprehensive retrieval**',
          }),
          traceEvent(3, 'AGENT_RESULT', {
            result: {
              outcome: 'completed',
              summary: 'Successfully read **RVMP-90**.\n\n- Status: in progress',
              data: {},
              artifacts: [],
              evidence: [],
            },
            usage: {
              inputTokens: 10,
              outputTokens: 20,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
            durationMs: 1_250,
          }),
        ]}
      />,
    )

    expect(screen.getByText('task').tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: 'ClickUp' }).getAttribute('href')).toBe(
      'https://app.clickup.com',
    )
    const firstReasoningParagraph = screen
      .getByText('Planning JSON retrieval with curl')
      .closest('p')
    const secondReasoningParagraph = screen
      .getByText('Planning comprehensive retrieval')
      .closest('p')
    expect(firstReasoningParagraph).not.toBe(secondReasoningParagraph)
    expect(container.querySelectorAll('[data-message-kind="reasoning"]')).toHaveLength(2)
    for (const reasoning of container.querySelectorAll('[data-message-kind="reasoning"]')) {
      expect(reasoning.getAttribute('data-variant')).toBe('muted')
    }
    expect(firstReasoningParagraph?.querySelector('strong, em, code, a, ul, ol')).toBeNull()
    expect(secondReasoningParagraph?.querySelector('strong, em, code, a, ul, ol')).toBeNull()
    expect(screen.getByText('RVMP-90').tagName).toBe('STRONG')
    expect(container.querySelectorAll('li')).toHaveLength(1)
  })

  it('does not show a tool until its execution has completed', () => {
    const { rerender } = render(
      <AgentTranscript
        prompt="Implement the requested change."
        result={undefined}
        streaming
        events={[
          traceEvent(1, 'AGENT_TOOL_STARTED', {
            toolCallId: 'tool-01',
            toolName: 'read_file',
            input: { path: 'apps/web/app/page.tsx' },
          }),
          traceEvent(2, 'AGENT_TOOL_UPDATED', {
            toolCallId: 'tool-01',
            content: 'Reading 42 lines',
          }),
        ]}
      />,
    )

    expect(screen.queryByRole('button', { name: /read_file/ })).toBeNull()

    rerender(
      <AgentTranscript
        prompt="Implement the requested change."
        result={undefined}
        streaming
        events={[
          traceEvent(1, 'AGENT_TOOL_STARTED', {
            toolCallId: 'tool-01',
            toolName: 'read_file',
            input: { path: 'apps/web/app/page.tsx' },
          }),
          traceEvent(2, 'AGENT_TOOL_UPDATED', {
            toolCallId: 'tool-01',
            content: 'Reading 42 lines',
          }),
          traceEvent(3, 'AGENT_TOOL_COMPLETED', {
            toolCallId: 'tool-01',
            toolName: 'read_file',
            status: 'succeeded',
            content: 'Read 42 lines',
          }),
        ]}
      />,
    )

    expect(screen.getByText('read_file')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /read_file/ })).toBeNull()
  })

  it('omits session bookkeeping and renders the terminal summary as agent text', () => {
    render(
      <AgentTranscript
        prompt="Implement the requested change."
        result={undefined}
        streaming={false}
        events={[
          traceEvent(1, 'AGENT_STARTED', {}),
          traceEvent(2, 'AGENT_SESSION_IDENTIFIED', { sessionId: 'session-01' }),
          traceEvent(3, 'AGENT_RESULT', {
            result: {
              outcome: 'completed',
              summary: 'The implementation is complete.',
              data: {},
              artifacts: [],
              evidence: [],
            },
            usage: {
              inputTokens: 10,
              outputTokens: 20,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
            durationMs: 1_250,
          }),
        ]}
      />,
    )

    expect(screen.queryByText('Agent started')).toBeNull()
    expect(screen.queryByText('Session ready')).toBeNull()
    expect(screen.getByText('The implementation is complete.')).toBeTruthy()
    expect(screen.queryByText('Completed in 1.3 s')).toBeNull()
    expect(screen.queryByText('Recorded trace')).toBeNull()
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
