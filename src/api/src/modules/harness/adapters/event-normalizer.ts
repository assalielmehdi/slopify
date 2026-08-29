import { HarnessIdSchema } from '@slopify/shared'

import type { AgentExecutionEvent, AgentToolKind } from './contract.js'
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
      | 'AGENT_SKILL_INVOKED'
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

const canonicalTool = (
  toolName: string,
): { readonly kind: AgentToolKind; readonly name: string } => {
  const normalized = toolName.toLowerCase()
  if (normalized === 'bash') return { kind: 'COMMAND', name: 'bash' }
  if (normalized === 'read' || normalized === 'read_file') return { kind: 'READ', name: 'read' }
  if (normalized === 'write' || normalized === 'write_file') return { kind: 'WRITE', name: 'write' }
  if (normalized === 'edit' || normalized === 'edit_file') return { kind: 'EDIT', name: 'edit' }
  if (normalized === 'grep' || normalized === 'find' || normalized === 'search') {
    return { kind: 'SEARCH', name: normalized }
  }
  return { kind: 'OTHER', name: toolName }
}

const capturedHarnessEvent = (
  event: Record<string, unknown>,
  redactor: EventRedactor,
): NormalizedPiEvent => {
  try {
    const serialized = JSON.stringify(event)
    if (serialized === undefined) throw new Error('Pi event is not JSON serializable')
    if (serialized.length > MAX_CONTENT_LENGTH) {
      return {
        type: 'HARNESS_EVENT',
        data: {
          harnessId: PI_HARNESS_ID,
          event: {
            type: typeof event.type === 'string' ? redactor.redact(event.type) : 'unknown',
            captureError: 'Pi event payload was omitted because it was too large',
          },
        },
      }
    }
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

const derivedSkillEvent = (
  toolCallId: string,
  toolName: string,
  input: unknown,
): NormalizedPiEvent | undefined => {
  if (toolName !== 'read' || !isRecord(input) || typeof input.path !== 'string') return undefined
  const match = /(?:^|[/\\])skills[/\\]([a-z0-9]+(?:[._-][a-z0-9]+)*)[/\\]SKILL\.md$/u.exec(
    input.path,
  )
  const skillName = match?.[1]
  if (skillName === undefined || skillName.length > 128) return undefined
  return {
    type: 'AGENT_SKILL_INVOKED',
    data: { skillName, evidence: 'DERIVED', sourceToolCallId: toolCallId },
  }
}

const messageEvent = (messageId: string, content: string): readonly NormalizedPiEvent[] => {
  const bounded = boundedContent(content)
  return bounded === undefined
    ? []
    : [{ type: 'AGENT_MESSAGE', data: { messageId, content: bounded } }]
}

const reasoningEvent = (messageId: string, content: string): readonly NormalizedPiEvent[] => {
  const bounded = boundedContent(content)
  return bounded === undefined
    ? []
    : [{ type: 'AGENT_REASONING', data: { messageId, content: bounded } }]
}

export const createPiEventNormalizer = (
  options: CreatePiEventNormalizerOptions,
): PiEventNormalizer => {
  let assistantText: RedactionStream = options.redactor.createStream()
  let reasoningText: RedactionStream = options.redactor.createStream()
  let assistantMessageId: string | undefined
  let assistantMessageNumber = 0
  let reasoningMessageId: string | undefined
  let reasoningMessageNumber = 0
  const toolStreams = new Map<string, { observedContent: string; redaction: RedactionStream }>()
  const resetAssistantText = (): void => {
    assistantText.finish()
    assistantText = options.redactor.createStream()
    assistantMessageId = undefined
  }
  const resetReasoningText = (): void => {
    reasoningText.finish()
    reasoningText = options.redactor.createStream()
    reasoningMessageId = undefined
  }
  const currentAssistantMessageId = (): string =>
    (assistantMessageId ??= `message-${++assistantMessageNumber}`)
  const currentReasoningMessageId = (): string =>
    (reasoningMessageId ??= `reasoning-${++reasoningMessageNumber}`)

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
              return [
                captured,
                ...messageEvent(
                  currentAssistantMessageId(),
                  assistantText.push(assistantEvent.delta),
                ),
              ]
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
                  ? [
                      captured,
                      ...reasoningEvent(
                        currentReasoningMessageId(),
                        reasoningText.push(assistantEvent.delta),
                      ),
                    ]
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
            const skill = derivedSkillEvent(event.toolCallId, event.toolName, event.args)
            const tool = canonicalTool(event.toolName)
            return [
              captured,
              {
                type: 'AGENT_TOOL_STARTED',
                data: {
                  toolCallId: event.toolCallId,
                  toolKind: tool.kind,
                  toolName: tool.name,
                  input: visibleToolInput(event.args, options.redactor),
                },
              },
              ...(skill === undefined ? [] : [skill]),
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
            const tool = canonicalTool(event.toolName)
            const content =
              boundedContent(options.redactor.redact(visibleToolContent(event.result))) ??
              (isError ? 'Tool failed' : 'Tool completed')
            return [
              captured,
              {
                type: 'AGENT_TOOL_COMPLETED',
                data: {
                  toolCallId: event.toolCallId,
                  toolKind: tool.kind,
                  toolName: tool.name,
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
