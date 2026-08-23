import { HarnessIdSchema } from '@slopify/contracts'

import type { AgentExecutionEvent } from './contract.js'
import type { EventRedactor, RedactionStream } from './redaction.js'

const MAX_CONTENT_LENGTH = 1_000_000
const PI_HARNESS_ID = HarnessIdSchema.parse('pi')
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

type ObservableAgentEvent = Extract<
  AgentExecutionEvent,
  {
    type:
      | 'AGENT_MESSAGE'
      | 'AGENT_REASONING'
      | 'HARNESS_EVENT'
      | 'AGENT_TOOL_STARTED'
      | 'AGENT_TOOL_UPDATED'
      | 'AGENT_TOOL_COMPLETED'
  }
>

type WithoutEventBase<T> = T extends unknown
  ? Omit<T, 'executionId' | 'runId' | 'nodeId' | 'timestamp'>
  : never

export type NormalizedPiEvent = WithoutEventBase<ObservableAgentEvent>

export interface PiEventNormalizer {
  normalize(event: unknown): readonly NormalizedPiEvent[]
  finish(): void
}

export interface CreatePiEventNormalizerOptions {
  readonly redactor: EventRedactor
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isToolCallId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512

const isToolName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128

const capturedHarnessEvent = (
  event: Record<string, unknown>,
  redactor: EventRedactor,
): NormalizedPiEvent => {
  try {
    const serialized = JSON.stringify(event)
    if (serialized === undefined) throw new Error('Pi event is not JSON serializable')
    return {
      type: 'HARNESS_EVENT',
      data: {
        harnessId: PI_HARNESS_ID,
        event: JSON.parse(redactor.redact(serialized)) as JsonValue,
      },
    }
  } catch {
    return {
      type: 'HARNESS_EVENT',
      data: {
        harnessId: PI_HARNESS_ID,
        event: {
          type: typeof event.type === 'string' ? redactor.redact(event.type) : 'unknown',
          captureError: 'Pi event payload could not be serialized',
        },
      },
    }
  }
}

const boundedContent = (content: string): string | undefined => {
  const bounded = content.slice(0, MAX_CONTENT_LENGTH)
  return bounded.trim().length === 0 ? undefined : bounded
}

const visibleToolContent = (result: unknown): string => {
  if (!isRecord(result) || !Array.isArray(result.content)) return ''
  let visible = ''
  for (const item of result.content) {
    if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') continue
    const next = `${visible.length === 0 ? '' : '\n'}${item.text}`
    visible += next.slice(0, MAX_CONTENT_LENGTH - visible.length)
    if (visible.length === MAX_CONTENT_LENGTH) break
  }
  return visible
}

const visibleToolInput = (input: unknown, redactor: EventRedactor): JsonValue => {
  try {
    const serialized = JSON.stringify(input)
    if (serialized === undefined) return null
    if (serialized.length > MAX_CONTENT_LENGTH) return '[Tool input omitted: too large]'
    return JSON.parse(redactor.redact(serialized)) as JsonValue
  } catch {
    return '[Tool input unavailable]'
  }
}

const messageEvent = (content: string): readonly NormalizedPiEvent[] => {
  const bounded = boundedContent(content)
  return bounded === undefined ? [] : [{ type: 'AGENT_MESSAGE', data: { content: bounded } }]
}

const reasoningEvent = (content: string): readonly NormalizedPiEvent[] => {
  const bounded = boundedContent(content)
  return bounded === undefined ? [] : [{ type: 'AGENT_REASONING', data: { content: bounded } }]
}

export const createPiEventNormalizer = (
  options: CreatePiEventNormalizerOptions,
): PiEventNormalizer => {
  let assistantText: RedactionStream = options.redactor.createStream()
  let reasoningText: RedactionStream = options.redactor.createStream()
  const toolStreams = new Map<string, { observedContent: string; redaction: RedactionStream }>()
  const resetAssistantText = (): void => {
    assistantText.finish()
    assistantText = options.redactor.createStream()
  }
  const resetReasoningText = (): void => {
    reasoningText.finish()
    reasoningText = options.redactor.createStream()
  }

  return {
    normalize(event) {
      if (!isRecord(event) || typeof event.type !== 'string') return []
      const captured = capturedHarnessEvent(event, options.redactor)

      try {
        switch (event.type) {
          case 'message_update': {
            if (!isRecord(event.assistantMessageEvent)) return [captured]
            const assistantEvent = event.assistantMessageEvent
            if (assistantEvent.type === 'text_delta' && typeof assistantEvent.delta === 'string') {
              return [captured, ...messageEvent(assistantText.push(assistantEvent.delta))]
            }
            switch (assistantEvent.type) {
              case 'text_end':
                resetAssistantText()
                return [captured]
              case 'thinking_start':
                resetReasoningText()
                return [captured]
              case 'thinking_delta':
                return typeof assistantEvent.delta === 'string'
                  ? [captured, ...reasoningEvent(reasoningText.push(assistantEvent.delta))]
                  : [captured]
              case 'thinking_end':
                resetReasoningText()
                return [captured]
              case 'start':
              case 'text_start':
              case 'toolcall_start':
              case 'toolcall_delta':
              case 'toolcall_end':
              case 'done':
              case 'error':
              default:
                return [captured]
            }
          }

          case 'tool_execution_start': {
            if (!isToolCallId(event.toolCallId) || !isToolName(event.toolName)) return [captured]
            toolStreams.get(event.toolCallId)?.redaction.finish()
            toolStreams.set(event.toolCallId, {
              observedContent: '',
              redaction: options.redactor.createStream(),
            })
            return [
              captured,
              {
                type: 'AGENT_TOOL_STARTED',
                data: {
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  input: visibleToolInput(event.args, options.redactor),
                },
              },
            ]
          }

          case 'tool_execution_update': {
            if (!isToolCallId(event.toolCallId)) return [captured]
            const visibleContent = visibleToolContent(event.partialResult)
            const toolStream = toolStreams.get(event.toolCallId) ?? {
              observedContent: '',
              redaction: options.redactor.createStream(),
            }
            const contentDelta = visibleContent.startsWith(toolStream.observedContent)
              ? visibleContent.slice(toolStream.observedContent.length)
              : visibleContent
            toolStream.observedContent = visibleContent.startsWith(toolStream.observedContent)
              ? visibleContent
              : `${toolStream.observedContent}${visibleContent}`.slice(0, MAX_CONTENT_LENGTH)
            toolStreams.set(event.toolCallId, toolStream)
            const content = boundedContent(toolStream.redaction.push(contentDelta))
            return content === undefined
              ? [captured]
              : [
                  captured,
                  {
                    type: 'AGENT_TOOL_UPDATED',
                    data: { toolCallId: event.toolCallId, content },
                  },
                ]
          }

          case 'tool_execution_end': {
            if (!isToolCallId(event.toolCallId) || !isToolName(event.toolName)) return [captured]
            toolStreams.get(event.toolCallId)?.redaction.finish()
            toolStreams.delete(event.toolCallId)
            const isError = event.isError === true
            const content =
              boundedContent(options.redactor.redact(visibleToolContent(event.result))) ??
              (isError ? 'Tool failed' : 'Tool completed')
            return [
              captured,
              {
                type: 'AGENT_TOOL_COMPLETED',
                data: {
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  status: isError ? 'failed' : 'succeeded',
                  content,
                },
              },
            ]
          }

          case 'message_start':
            resetAssistantText()
            resetReasoningText()
            return [captured]

          case 'message_end':
            resetAssistantText()
            resetReasoningText()
            return [captured]

          case 'agent_start':
          case 'agent_end':
          case 'agent_settled':
          case 'turn_start':
          case 'turn_end':
          case 'queue_update':
          case 'compaction_start':
          case 'compaction_end':
          case 'entry_appended':
          case 'session_info_changed':
          case 'thinking_level_changed':
          case 'auto_retry_start':
          case 'auto_retry_end':
          case 'summarization_retry_scheduled':
          case 'summarization_retry_attempt_start':
          case 'summarization_retry_finished':
          case 'bash_execution_update':
          default:
            return [captured]
        }
      } catch {
        return [captured]
      }
    },
    finish() {
      resetAssistantText()
      resetReasoningText()
      for (const stream of toolStreams.values()) stream.redaction.finish()
      toolStreams.clear()
    },
  }
}
