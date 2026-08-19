import { describe, expect, it } from 'vitest'

import { createPiEventNormalizer } from '../src/event-normalizer.js'
import { createEventRedactor } from '../src/redaction.js'

const secret = 'sk-provider-secret'

const createNormalizer = () =>
  createPiEventNormalizer({
    redactor: createEventRedactor({ sensitiveValues: [secret] }),
  })

describe('Pi event normalizer', () => {
  it('preserves visible assistant text in order while dropping thinking deltas', () => {
    const normalizer = createNormalizer()

    const first = normalizer.normalize({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: `Visible ${secret}. ` },
    })
    const thinking = ['thinking_start', 'thinking_delta', 'thinking_end'].flatMap((type) =>
      normalizer.normalize({
        type: 'message_update',
        assistantMessageEvent: {
          type,
          delta: `Hidden reasoning with ${secret}`,
          content: `Hidden reasoning with ${secret}`,
        },
      }),
    )
    const second = normalizer.normalize({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Done.' },
    })
    const ended = normalizer.normalize({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_end', content: `Visible ${secret}. Done.` },
    })

    expect([...first, ...thinking, ...second, ...ended]).toEqual([
      { type: 'AGENT_MESSAGE', data: { content: 'Visible [REDACTED]. ' } },
      { type: 'AGENT_MESSAGE', data: { content: 'Done.' } },
    ])
  })

  it('maps tool lifecycle evidence without exposing arguments, details, or credentials', () => {
    const normalizer = createNormalizer()

    const events = [
      ...normalizer.normalize({
        type: 'tool_execution_start',
        toolCallId: 'tool-01',
        toolName: 'bash',
        args: { command: `echo ${secret}` },
      }),
      ...normalizer.normalize({
        type: 'tool_execution_update',
        toolCallId: 'tool-01',
        toolName: 'bash',
        args: { command: `echo ${secret}` },
        partialResult: {
          content: [{ type: 'text', text: `token=${secret}\nrunning` }],
          details: { credential: secret },
        },
      }),
      ...normalizer.normalize({
        type: 'tool_execution_end',
        toolCallId: 'tool-01',
        toolName: 'bash',
        result: {
          content: [{ type: 'text', text: `completed with ${secret}` }],
          details: { credential: secret },
        },
        isError: false,
      }),
    ]

    expect(events).toEqual([
      {
        type: 'AGENT_TOOL_STARTED',
        data: { toolCallId: 'tool-01', toolName: 'bash' },
      },
      {
        type: 'AGENT_TOOL_UPDATED',
        data: { toolCallId: 'tool-01', content: 'token=[REDACTED]\nrunning' },
      },
      {
        type: 'AGENT_TOOL_COMPLETED',
        data: {
          toolCallId: 'tool-01',
          toolName: 'bash',
          status: 'succeeded',
          content: 'completed with [REDACTED]',
        },
      },
    ])
    expect(JSON.stringify(events)).not.toContain(secret)
    expect(JSON.stringify(events)).not.toContain('command')
    expect(JSON.stringify(events)).not.toContain('details')
  })

  it('maps failed empty tool results to a bounded visible completion', () => {
    const normalizer = createNormalizer()

    expect(
      normalizer.normalize({
        type: 'tool_execution_end',
        toolCallId: 'tool-02',
        toolName: 'read',
        result: { content: [{ type: 'image', data: secret, mimeType: 'image/png' }] },
        isError: true,
      }),
    ).toEqual([
      {
        type: 'AGENT_TOOL_COMPLETED',
        data: {
          toolCallId: 'tool-02',
          toolName: 'read',
          status: 'failed',
          content: 'Tool failed',
        },
      },
    ])
  })

  it('redacts a credential split across incremental tool updates', () => {
    const normalizer = createNormalizer()
    normalizer.normalize({
      type: 'tool_execution_start',
      toolCallId: 'tool-03',
      toolName: 'bash',
      args: {},
    })

    const first = normalizer.normalize({
      type: 'tool_execution_update',
      toolCallId: 'tool-03',
      toolName: 'bash',
      partialResult: { content: [{ type: 'text', text: 'output sk-provider-' }] },
    })
    const second = normalizer.normalize({
      type: 'tool_execution_update',
      toolCallId: 'tool-03',
      toolName: 'bash',
      partialResult: { content: [{ type: 'text', text: 'secret done' }] },
    })

    expect([...first, ...second]).toEqual([
      {
        type: 'AGENT_TOOL_UPDATED',
        data: { toolCallId: 'tool-03', content: 'output ' },
      },
      {
        type: 'AGENT_TOOL_UPDATED',
        data: { toolCallId: 'tool-03', content: '[REDACTED] done' },
      },
    ])
  })

  it.each([
    'agent_start',
    'agent_end',
    'agent_settled',
    'turn_start',
    'turn_end',
    'message_start',
    'message_end',
    'queue_update',
    'compaction_start',
    'compaction_end',
    'entry_appended',
    'session_info_changed',
    'thinking_level_changed',
    'auto_retry_start',
    'auto_retry_end',
    'summarization_retry_scheduled',
    'summarization_retry_attempt_start',
    'summarization_retry_finished',
    'bash_execution_update',
  ])('intentionally emits no application event for %s', (type) => {
    expect(createNormalizer().normalize({ type })).toEqual([])
  })

  it('drops malformed, unknown, and invalid-identifier events at the untrusted boundary', () => {
    const normalizer = createNormalizer()

    expect(normalizer.normalize(null)).toEqual([])
    expect(normalizer.normalize({ type: 'future_event', credential: secret })).toEqual([])
    expect(
      normalizer.normalize({
        type: 'tool_execution_start',
        toolCallId: '../unsafe',
        toolName: 'bash',
      }),
    ).toEqual([])
  })

  it('drops hostile third-party event objects without throwing', () => {
    const event = {
      type: 'tool_execution_update',
      toolCallId: 'tool-01',
      get partialResult(): never {
        throw new Error(secret)
      },
    }

    expect(createNormalizer().normalize(event)).toEqual([])
  })

  it('bounds one observable tool payload to the application contract limit', () => {
    const events = createNormalizer().normalize({
      type: 'tool_execution_end',
      toolCallId: 'tool-04',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: 'x'.repeat(1_000_100) }] },
      isError: false,
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.data).toMatchObject({ content: expect.any(String) })
    if (events[0]?.type === 'AGENT_TOOL_COMPLETED') {
      expect(events[0].data.content).toHaveLength(1_000_000)
    }
  })
})
