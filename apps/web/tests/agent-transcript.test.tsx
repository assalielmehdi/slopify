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
    timestamp: `2026-08-22T10:00:${String(sequence).padStart(2, '0')}.000Z`,
    type,
    data,
  })

afterEach(cleanup)

describe('AgentTranscript', () => {
  it('collapses work details by default, keeps the result visible, and groups adjacent tools', () => {
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
          traceEvent(6, 'AGENT_TOOL_STARTED', {
            toolCallId: 'tool-02',
            toolName: 'bash',
            input: { command: 'git status' },
          }),
          traceEvent(7, 'AGENT_TOOL_COMPLETED', {
            toolCallId: 'tool-02',
            toolName: 'bash',
            status: 'failed',
            content: 'Command failed',
          }),
          traceEvent(8, 'AGENT_REASONING', { content: 'I should inspect another file.' }),
          traceEvent(9, 'AGENT_TOOL_COMPLETED', {
            toolCallId: 'tool-03',
            toolName: 'read_file',
            status: 'succeeded',
            content: 'Read another file',
          }),
          traceEvent(10, 'AGENT_RESULT', {
            result: {
              outcome: 'completed',
              summary: 'The implementation is complete.',
              data: {},
              evidence: [],
            },
            usage: {
              inputTokens: 10,
              outputTokens: 20,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
            durationMs: 93_000,
          }),
        ]}
      />,
    )

    const disclosure = screen.getByRole('button', { name: 'Worked for 1m 33s' })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('I should inspect the source first.')).toBeNull()
    expect(screen.queryByText('read_file and bash')).toBeNull()
    expect(screen.getByText('The implementation is complete.')).toBeTruthy()
    expect(screen.getByText('Agent')).toBeTruthy()
    expect(screen.queryByText('Pi agent')).toBeNull()

    fireEvent.click(disclosure)

    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    const reasoning = screen.getByText('I should inspect the source first.')
    expect(reasoning.closest('[data-message-kind="reasoning"]')).toBeTruthy()
    expect(screen.getAllByText('Reasoning')).toHaveLength(2)
    const toolGroups = container.querySelectorAll('[data-message-kind="tool-group"]')
    expect(toolGroups).toHaveLength(2)
    expect(screen.getByText('read_file and bash')).toBeTruthy()
    expect(screen.getByText('1 failed')).toBeTruthy()
    expect(screen.getAllByText('read_file')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /read_file/ })).toBeNull()
    expect(screen.queryByText(/apps\/web\/app\/page.tsx/)).toBeNull()
    expect(screen.queryByText('Reading 42 lines')).toBeNull()
    expect(screen.queryByText('Read 42 lines')).toBeNull()
    const response = screen.getByText('The implementation is complete.')
    expect(response.closest('[data-message-kind="result"]')).toBeTruthy()
    expect(screen.queryByText('Intermediate assistant text.')).toBeNull()
    expect(container.querySelectorAll('[data-message-kind]')).toHaveLength(5)
  })

  it('renders Markdown in prompt and results while reasoning remains plain text', () => {
    const { container } = render(
      <AgentTranscript
        prompt="Read the **request** and visit [Reference](https://example.com/reference)."
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

    expect(screen.getByText('request').tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: 'Reference' }).getAttribute('href')).toBe(
      'https://example.com/reference',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Worked for 1.3 s' }))
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

    fireEvent.click(screen.getByRole('button', { name: 'Work details' }))
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
    expect(screen.getByRole('button', { name: 'Worked for 1.3 s' })).toBeTruthy()
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

  it('uses raw harness events to group streamed reasoning updates', () => {
    const { container } = render(
      <AgentTranscript
        prompt="Inspect the repository."
        result={undefined}
        streaming={false}
        events={[
          traceEvent(1, 'HARNESS_EVENT', {
            harnessId: 'pi',
            event: {
              type: 'message_update',
              assistantMessageEvent: { type: 'thinking_start' },
            },
          }),
          traceEvent(2, 'AGENT_REASONING', { content: 'Inspecting ' }),
          traceEvent(3, 'AGENT_REASONING', { content: 'the repository.' }),
          traceEvent(4, 'HARNESS_EVENT', {
            harnessId: 'pi',
            event: {
              type: 'message_update',
              assistantMessageEvent: { type: 'thinking_end' },
            },
          }),
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Work details' }))
    expect(screen.getByText('Inspecting the repository.')).toBeTruthy()
    expect(container.querySelectorAll('[data-message-kind="reasoning"]')).toHaveLength(1)
  })
})
