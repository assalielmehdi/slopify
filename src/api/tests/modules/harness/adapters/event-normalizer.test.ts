import { describe, expect, it } from 'vitest'

import { createPiEventNormalizer } from '../../../../src/modules/harness/adapters/event-normalizer.js'
import { createEventRedactor } from '../../../../src/modules/harness/adapters/redaction.js'

const secret = 'host-secret-value'

const createNormalizer = () =>
  createPiEventNormalizer({
    redactor: createEventRedactor({ sensitiveValues: [secret] }),
  })

describe('Pi event normalizer', () => {
  const applicationEvents = <T extends { readonly type: string }>(events: readonly T[]): T[] =>
    events.filter(({ type }) => type !== 'HARNESS_EVENT')

  it('preserves visible assistant text and reasoning in order', () => {
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

    expect(applicationEvents([...first, ...thinking, ...second, ...ended])).toEqual([
      { type: 'AGENT_MESSAGE', data: { content: 'Visible [REDACTED]. ' } },
      { type: 'AGENT_REASONING', data: { content: 'Hidden reasoning with [REDACTED]' } },
      { type: 'AGENT_MESSAGE', data: { content: 'Done.' } },
    ])
  })

  it('maps tool lifecycle evidence with redacted arguments and without private details', () => {
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

    expect(applicationEvents(events)).toEqual([
      {
        type: 'AGENT_TOOL_STARTED',
        data: {
          toolCallId: 'tool-01',
          toolName: 'bash',
          input: { command: 'echo [REDACTED]' },
        },
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
    expect(JSON.stringify(events)).toContain('details')
  })

  it('maps failed empty tool results to a bounded visible completion', () => {
    const normalizer = createNormalizer()

    expect(
      applicationEvents(
        normalizer.normalize({
          type: 'tool_execution_end',
          toolCallId: 'tool-02',
          toolName: 'read',
          result: { content: [{ type: 'image', data: secret, mimeType: 'image/png' }] },
          isError: true,
        }),
      ),
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
      partialResult: { content: [{ type: 'text', text: 'output host-secret-' }] },
    })
    const second = normalizer.normalize({
      type: 'tool_execution_update',
      toolCallId: 'tool-03',
      toolName: 'bash',
      partialResult: { content: [{ type: 'text', text: 'value done' }] },
    })

    expect(applicationEvents([...first, ...second])).toEqual([
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
    { type: 'agent_start' },
    { type: 'agent_end', messages: [], willRetry: false },
    { type: 'agent_settled' },
    { type: 'turn_start' },
    { type: 'turn_end', message: { role: 'assistant', content: [] }, toolResults: [] },
    { type: 'message_start', message: { role: 'assistant', content: [] } },
    { type: 'message_update', assistantMessageEvent: { type: 'start' } },
    { type: 'message_end', message: { role: 'assistant', content: [] } },
    { type: 'tool_execution_start', toolCallId: 'call_ABC|fc_XYZ', toolName: 'bash', args: {} },
    {
      type: 'tool_execution_update',
      toolCallId: 'call_ABC|fc_XYZ',
      toolName: 'bash',
      args: {},
      partialResult: { content: [] },
    },
    {
      type: 'tool_execution_end',
      toolCallId: 'call_ABC|fc_XYZ',
      toolName: 'bash',
      result: { content: [] },
      isError: false,
    },
    { type: 'queue_update', steering: [], followUp: [] },
    { type: 'compaction_start', reason: 'threshold' },
    { type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false },
    { type: 'entry_appended', entry: { type: 'label', label: 'checkpoint' } },
    { type: 'session_info_changed', name: 'Inspection' },
    { type: 'thinking_level_changed', level: 'medium' },
    { type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 100, errorMessage: 'retry' },
    { type: 'auto_retry_end', success: true, attempt: 1 },
    {
      type: 'summarization_retry_scheduled',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: 'retry',
    },
    { type: 'summarization_retry_attempt_start', source: 'branchSummary' },
    { type: 'summarization_retry_finished' },
    { type: 'bash_execution_update', id: 'bash-01', delta: 'output' },
  ])('faithfully captures the Pi RPC $type event', (harnessEvent) => {
    expect(createNormalizer().normalize(harnessEvent)).toContainEqual({
      type: 'HARNESS_EVENT',
      data: { harnessId: 'pi', event: harnessEvent },
    })
  })

  it('accepts harness-generated tool call identifiers without losing derived tool events', () => {
    const harnessEvent = {
      type: 'tool_execution_start',
      toolCallId: 'call_JkP9a|fc_72ZQ',
      toolName: 'bash',
      args: { command: 'pwd' },
    }

    expect(createNormalizer().normalize(harnessEvent)).toEqual([
      { type: 'HARNESS_EVENT', data: { harnessId: 'pi', event: harnessEvent } },
      {
        type: 'AGENT_TOOL_STARTED',
        data: {
          toolCallId: 'call_JkP9a|fc_72ZQ',
          toolName: 'bash',
          input: { command: 'pwd' },
        },
      },
    ])
  })

  it('derives skill evidence only from a skill definition read', () => {
    const skillRead = createNormalizer().normalize({
      type: 'tool_execution_start',
      toolCallId: 'call_skill_01',
      toolName: 'read',
      args: { path: '/Users/operator/.agents/skills/browser-testing/SKILL.md' },
    })
    const ordinaryRead = createNormalizer().normalize({
      type: 'tool_execution_start',
      toolCallId: 'call_read_01',
      toolName: 'read',
      args: { path: '/workspace/docs/SKILL.md' },
    })

    expect(applicationEvents(skillRead)).toContainEqual({
      type: 'AGENT_SKILL_INVOKED',
      data: {
        skillName: 'browser-testing',
        evidence: 'DERIVED',
        sourceToolCallId: 'call_skill_01',
      },
    })
    expect(applicationEvents(ordinaryRead).some(({ type }) => type === 'AGENT_SKILL_INVOKED')).toBe(
      false,
    )
  })

  it('omits oversized raw harness payloads while preserving their event type', () => {
    const events = createNormalizer().normalize({
      type: 'future_event',
      content: 'x'.repeat(1_000_001),
    })

    expect(events).toEqual([
      {
        type: 'HARNESS_EVENT',
        data: {
          harnessId: 'pi',
          event: {
            type: 'future_event',
            captureError: 'Pi event payload was omitted because it was too large',
          },
        },
      },
    ])
  })

  it.each([
    { type: 'start' },
    { type: 'text_start', contentIndex: 0 },
    { type: 'text_delta', contentIndex: 0, delta: 'answer' },
    { type: 'text_end', contentIndex: 0, content: 'answer' },
    { type: 'thinking_start', contentIndex: 0 },
    { type: 'thinking_delta', contentIndex: 0, delta: 'reasoning' },
    { type: 'thinking_end', contentIndex: 0, content: 'reasoning' },
    { type: 'toolcall_start', contentIndex: 0 },
    { type: 'toolcall_delta', contentIndex: 0, delta: '{"path":"/"}' },
    {
      type: 'toolcall_end',
      contentIndex: 0,
      toolCall: { type: 'toolCall', id: 'call_01|fc_01', name: 'read', arguments: {} },
    },
    { type: 'done', reason: 'stop' },
    { type: 'error', reason: 'error' },
  ])('faithfully captures the Pi assistant message $type event', (assistantMessageEvent) => {
    const harnessEvent = { type: 'message_update', assistantMessageEvent }

    expect(createNormalizer().normalize(harnessEvent)).toContainEqual({
      type: 'HARNESS_EVENT',
      data: { harnessId: 'pi', event: harnessEvent },
    })
  })

  it('drops non-events but preserves unknown future Pi events without leaking credentials', () => {
    const normalizer = createNormalizer()

    expect(normalizer.normalize(null)).toEqual([])
    expect(normalizer.normalize({ type: 'future_event', credential: secret })).toEqual([
      {
        type: 'HARNESS_EVENT',
        data: {
          harnessId: 'pi',
          event: { type: 'future_event', credential: '[REDACTED]' },
        },
      },
    ])
  })

  it('drops hostile third-party event objects without throwing', () => {
    const event = {
      type: 'tool_execution_update',
      toolCallId: 'tool-01',
      get partialResult(): never {
        throw new Error(secret)
      },
    }

    expect(createNormalizer().normalize(event)).toEqual([
      {
        type: 'HARNESS_EVENT',
        data: {
          harnessId: 'pi',
          event: {
            type: 'tool_execution_update',
            captureError: 'Pi event payload could not be serialized',
          },
        },
      },
    ])
  })

  it('bounds one observable tool payload to the application contract limit', () => {
    const events = createNormalizer().normalize({
      type: 'tool_execution_end',
      toolCallId: 'tool-04',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: 'x'.repeat(1_000_100) }] },
      isError: false,
    })

    const applicationEvent = applicationEvents(events)[0]
    expect(applicationEvent?.data).toMatchObject({ content: expect.any(String) })
    if (applicationEvent?.type === 'AGENT_TOOL_COMPLETED') {
      expect(applicationEvent.data.content).toHaveLength(1_000_000)
    }
  })
})
