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
  it('collapses work details by default and renders work in invocation order when expanded', () => {
    const { container } = render(
      <AgentTranscript
        prompt="Implement the requested change."
        result={undefined}
        streaming={false}
        events={[
          traceEvent(1, 'AGENT_REASONING', { content: 'I should inspect the source first.' }),
          traceEvent(2, 'AGENT_TOOL_STARTED', {
            toolCallId: 'tool-01',
            toolName: 'read',
            input: { path: 'apps/web/app/page.tsx' },
          }),
          traceEvent(3, 'AGENT_TOOL_STARTED', {
            toolCallId: 'tool-02',
            toolName: 'bash',
            input: { command: 'git status' },
          }),
          traceEvent(4, 'AGENT_TOOL_COMPLETED', {
            toolCallId: 'tool-02',
            toolName: 'bash',
            status: 'failed',
            content: 'Command failed',
          }),
          traceEvent(5, 'AGENT_TOOL_COMPLETED', {
            toolCallId: 'tool-01',
            toolName: 'read',
            status: 'succeeded',
            content: 'Read 42 lines',
          }),
          traceEvent(6, 'AGENT_MESSAGE', { content: 'Intermediate assistant text.' }),
          traceEvent(7, 'AGENT_REASONING', { content: 'I should inspect another file.' }),
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
    expect(screen.queryByText('apps/web/app/page.tsx')).toBeNull()
    expect(screen.getByText('The implementation is complete.')).toBeTruthy()
    expect(screen.getByText('Agent')).toBeTruthy()
    expect(screen.queryByText('Pi agent')).toBeNull()

    fireEvent.click(disclosure)

    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    const reasoning = screen.getByText('I should inspect the source first.')
    expect(reasoning.closest('[data-message-kind="reasoning"]')).toBeTruthy()
    expect(screen.queryByText('Reasoning')).toBeNull()
    const toolCalls = container.querySelectorAll('[data-message-kind="tool"]')
    expect(toolCalls).toHaveLength(2)
    expect(toolCalls[0]?.getAttribute('data-tool-name')).toBe('read')
    expect(toolCalls[1]?.getAttribute('data-tool-name')).toBe('bash')
    expect(toolCalls[0]?.textContent).toContain('read apps/web/app/page.tsx')
    expect(screen.getByText('git status')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
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
    expect(firstReasoningParagraph?.querySelector('strong, em, code, a, ul, ol')).toBeNull()
    expect(secondReasoningParagraph?.querySelector('strong, em, code, a, ul, ol')).toBeNull()
    expect(screen.getByText('RVMP-90').tagName).toBe('STRONG')
    expect(container.querySelectorAll('li')).toHaveLength(1)
  })

  it('shows a running tool from its start event and updates it in place', () => {
    const { container, rerender } = render(
      <AgentTranscript
        prompt="Implement the requested change."
        result={undefined}
        streaming
        events={[
          traceEvent(1, 'AGENT_TOOL_STARTED', {
            toolCallId: 'tool-01',
            toolName: 'read',
            input: { path: 'apps/web/app/page.tsx' },
          }),
          traceEvent(2, 'AGENT_TOOL_UPDATED', {
            toolCallId: 'tool-01',
            content: 'Reading 42 lines',
          }),
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Work details' }))
    const runningTool = container.querySelector('[data-message-kind="tool"]')
    expect(runningTool?.textContent).toContain('read apps/web/app/page.tsx')
    expect(screen.getByText('Running')).toBeTruthy()

    rerender(
      <AgentTranscript
        prompt="Implement the requested change."
        result={undefined}
        streaming
        events={[
          traceEvent(1, 'AGENT_TOOL_STARTED', {
            toolCallId: 'tool-01',
            toolName: 'read',
            input: { path: 'apps/web/app/page.tsx' },
          }),
          traceEvent(2, 'AGENT_TOOL_UPDATED', {
            toolCallId: 'tool-01',
            content: 'Reading 42 lines',
          }),
          traceEvent(3, 'AGENT_TOOL_COMPLETED', {
            toolCallId: 'tool-01',
            toolName: 'read',
            status: 'succeeded',
            content: 'Read 42 lines',
          }),
        ]}
      />,
    )

    expect(container.querySelector('[data-message-kind="tool"]')?.textContent).toContain(
      'read apps/web/app/page.tsx',
    )
    expect(screen.queryByText('Running')).toBeNull()
    expect(screen.queryByText('Reading 42 lines')).toBeNull()
  })

  it('renders bounded, independently expandable previews for each supported tool', () => {
    const writeContent = Array.from({ length: 13 }, (_, index) => `write line ${index + 1}`).join(
      '\n',
    )
    const bashOutput = Array.from({ length: 8 }, (_, index) => `output line ${index + 1}`).join(
      '\n',
    )
    render(
      <AgentTranscript
        prompt="Inspect and update the repository."
        result={undefined}
        streaming={false}
        events={[
          traceEvent(1, 'AGENT_TOOL_STARTED', {
            toolCallId: 'skill-01',
            toolName: 'read',
            input: {
              path: '/Users/example/.agents/skills/planning-and-task-breakdown/SKILL.md',
            },
          }),
          traceEvent(2, 'AGENT_TOOL_COMPLETED', {
            toolCallId: 'skill-01',
            toolName: 'read',
            status: 'succeeded',
            content: 'Skill contents',
          }),
          traceEvent(3, 'AGENT_TOOL_STARTED', {
            toolCallId: 'read-01',
            toolName: 'read',
            input: { path: 'apps/web/app/page.tsx', offset: 5, limit: 8 },
          }),
          traceEvent(4, 'AGENT_TOOL_COMPLETED', {
            toolCallId: 'read-01',
            toolName: 'read',
            status: 'succeeded',
            content: 'File contents',
          }),
          traceEvent(5, 'AGENT_TOOL_STARTED', {
            toolCallId: 'write-01',
            toolName: 'write',
            input: { path: 'apps/web/new.ts', content: writeContent },
          }),
          traceEvent(6, 'AGENT_TOOL_COMPLETED', {
            toolCallId: 'write-01',
            toolName: 'write',
            status: 'succeeded',
            content: 'Wrote file',
          }),
          traceEvent(7, 'AGENT_TOOL_STARTED', {
            toolCallId: 'edit-01',
            toolName: 'edit',
            input: {
              path: 'apps/web/existing.ts',
              edits: [
                {
                  oldText: 'const before = true\nconst stale = true',
                  newText: 'const after = true\nconst current = true',
                },
              ],
            },
          }),
          traceEvent(8, 'AGENT_TOOL_COMPLETED', {
            toolCallId: 'edit-01',
            toolName: 'edit',
            status: 'succeeded',
            content: 'Edited file',
          }),
          traceEvent(10, 'AGENT_TOOL_STARTED', {
            toolCallId: 'bash-01',
            toolName: 'bash',
            input: { command: 'git status --short', timeout: 30 },
          }),
          traceEvent(13, 'AGENT_TOOL_COMPLETED', {
            toolCallId: 'bash-01',
            toolName: 'bash',
            status: 'succeeded',
            content: bashOutput,
          }),
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Work details' }))

    expect(screen.getByText('[skill] planning-and-task-breakdown')).toBeTruthy()
    expect(screen.getByText('read apps/web/app/page.tsx:5-12')).toBeTruthy()
    expect(screen.queryByText('Skill contents')).toBeNull()
    expect(screen.queryByText('File contents')).toBeNull()
    expect(screen.getByText('write apps/web/new.ts')).toBeTruthy()
    expect(screen.getByText('write line 10')).toBeTruthy()
    expect(screen.queryByText('write line 11')).toBeNull()
    const moreWriteLines = screen.getByRole('button', {
      name: 'Show 3 more lines, 13 total',
    })
    expect(moreWriteLines.textContent).toBe('... (3 more lines, 13 total)')
    fireEvent.click(moreWriteLines)
    expect(screen.getByText('write line 13')).toBeTruthy()

    expect(screen.getByText('edit apps/web/existing.ts')).toBeTruthy()
    expect(screen.getByText('- const before = true')).toBeTruthy()
    expect(screen.getByText('+ const current = true')).toBeTruthy()

    expect(screen.getByText('git status --short')).toBeTruthy()
    expect(screen.getByText('(timeout 30s)')).toBeTruthy()
    expect(screen.queryByText('output line 1')).toBeNull()
    expect(screen.getByText('output line 4')).toBeTruthy()
    const earlierBashLines = screen.getByRole('button', { name: 'Show 3 earlier lines' })
    expect(earlierBashLines.textContent).toBe('... (3 earlier lines)')
    fireEvent.click(earlierBashLines)
    expect(screen.getByText('output line 1')).toBeTruthy()
    expect(screen.getByText('Took 3.0 s')).toBeTruthy()
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
