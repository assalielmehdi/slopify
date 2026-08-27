import { HarnessIdSchema } from '@slopify/contracts'

import type { AgentExecutionEvent } from './contract.js'
import type { EventRedactor } from './redaction.js'

const MAX_CONTENT_LENGTH = 1_000_000
const CODEX_HARNESS_ID = HarnessIdSchema.parse('codex')
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

type ObservableAgentEvent = Extract<
  AgentExecutionEvent,
  {
    type:
      | 'AGENT_MESSAGE'
      | 'AGENT_REASONING'
      | 'HARNESS_EVENT'
      | 'AGENT_TOOL_STARTED'
      | 'AGENT_TOOL_COMPLETED'
  }
>

type WithoutEventBase<T> = T extends unknown
  ? Omit<T, 'executionId' | 'runId' | 'nodeId' | 'timestamp'>
  : never

export type NormalizedCodexEvent = WithoutEventBase<ObservableAgentEvent>

export interface CodexEventNormalizer {
  normalize(event: unknown): readonly NormalizedCodexEvent[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const boundedContent = (content: string): string | undefined => {
  const bounded = content.slice(0, MAX_CONTENT_LENGTH)
  return bounded.trim().length === 0 ? undefined : bounded
}

const visibleJson = (value: unknown, redactor: EventRedactor): JsonValue => {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) return null
    if (serialized.length > MAX_CONTENT_LENGTH) return '[Value omitted: too large]'
    return JSON.parse(redactor.redact(serialized)) as JsonValue
  } catch {
    return '[Value unavailable]'
  }
}

const capturedHarnessEvent = (
  event: Record<string, unknown>,
  redactor: EventRedactor,
): NormalizedCodexEvent => {
  try {
    const serialized = JSON.stringify(event)
    if (serialized === undefined) throw new Error('Codex event is not JSON serializable')
    if (serialized.length > MAX_CONTENT_LENGTH) {
      return {
        type: 'HARNESS_EVENT',
        data: {
          harnessId: CODEX_HARNESS_ID,
          event: {
            type: typeof event.type === 'string' ? redactor.redact(event.type) : 'unknown',
            captureError: 'Codex event payload was omitted because it was too large',
          },
        },
      }
    }
    return {
      type: 'HARNESS_EVENT',
      data: {
        harnessId: CODEX_HARNESS_ID,
        event: JSON.parse(redactor.redact(serialized)) as JsonValue,
      },
    }
  } catch {
    return {
      type: 'HARNESS_EVENT',
      data: {
        harnessId: CODEX_HARNESS_ID,
        event: {
          type: typeof event.type === 'string' ? redactor.redact(event.type) : 'unknown',
          captureError: 'Codex event payload could not be serialized',
        },
      },
    }
  }
}

const toolCallId = (item: Record<string, unknown>): string | undefined =>
  typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 512 ? item.id : undefined

const toolName = (item: Record<string, unknown>): string | undefined => {
  switch (item.type) {
    case 'command_execution':
    case 'file_change':
    case 'mcp_tool_call':
    case 'web_search':
      return item.type
    default:
      return undefined
  }
}

const toolInput = (item: Record<string, unknown>, redactor: EventRedactor): JsonValue => {
  switch (item.type) {
    case 'command_execution':
      return visibleJson({ command: item.command }, redactor)
    case 'mcp_tool_call':
      return visibleJson(
        { server: item.server, tool: item.tool, arguments: item.arguments },
        redactor,
      )
    case 'web_search':
      return visibleJson({ query: item.query }, redactor)
    case 'file_change':
      return visibleJson({ changes: item.changes }, redactor)
    default:
      return null
  }
}

const toolContent = (item: Record<string, unknown>, redactor: EventRedactor): string => {
  for (const candidate of [
    item.aggregated_output,
    item.output,
    item.result,
    item.error,
    item.changes,
  ]) {
    if (typeof candidate === 'string') {
      const content = boundedContent(redactor.redact(candidate))
      if (content !== undefined) return content
    } else if (candidate !== undefined) {
      const serialized = visibleJson(candidate, redactor)
      const content = boundedContent(
        typeof serialized === 'string' ? serialized : JSON.stringify(serialized),
      )
      if (content !== undefined) return content
    }
  }
  return item.status === 'failed' ? 'Tool failed' : 'Tool completed'
}

export const createCodexEventNormalizer = (options: {
  readonly redactor: EventRedactor
}): CodexEventNormalizer => ({
  normalize(event) {
    if (!isRecord(event) || typeof event.type !== 'string') return []
    const captured = capturedHarnessEvent(event, options.redactor)
    try {
      if (
        (event.type !== 'item.started' && event.type !== 'item.completed') ||
        !isRecord(event.item)
      ) {
        return [captured]
      }

      const item = event.item
      if (event.type === 'item.completed' && item.type === 'agent_message') {
        if (typeof item.text !== 'string') return [captured]
        const content = boundedContent(options.redactor.redact(item.text))
        return content === undefined
          ? [captured]
          : [captured, { type: 'AGENT_MESSAGE', data: { content } }]
      }
      if (event.type === 'item.completed' && item.type === 'reasoning') {
        if (typeof item.text !== 'string') return [captured]
        const content = boundedContent(options.redactor.redact(item.text))
        return content === undefined
          ? [captured]
          : [captured, { type: 'AGENT_REASONING', data: { content } }]
      }

      const id = toolCallId(item)
      const name = toolName(item)
      if (id === undefined || name === undefined) return [captured]
      if (event.type === 'item.started') {
        return [
          captured,
          {
            type: 'AGENT_TOOL_STARTED',
            data: { toolCallId: id, toolName: name, input: toolInput(item, options.redactor) },
          },
        ]
      }
      return [
        captured,
        {
          type: 'AGENT_TOOL_COMPLETED',
          data: {
            toolCallId: id,
            toolName: name,
            status: item.status === 'failed' ? 'failed' : 'succeeded',
            content: toolContent(item, options.redactor),
          },
        },
      ]
    } catch {
      return [captured]
    }
  },
})
