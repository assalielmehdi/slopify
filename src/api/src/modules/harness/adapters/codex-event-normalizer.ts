import { HarnessIdSchema } from '@slopify/shared'

import type { AgentExecutionEvent, AgentToolKind } from './contract.js'
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
      | 'AGENT_SKILL_INVOKED'
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

const agentMessageContent = (content: string): string => {
  try {
    const parsed = JSON.parse(content) as unknown
    if (isRecord(parsed) && typeof parsed.summary === 'string') {
      return parsed.summary
    }
  } catch {
    // Plain assistant messages are already presentation-ready.
  }
  return content
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

const tool = (
  item: Record<string, unknown>,
): { readonly kind: AgentToolKind; readonly name: string } | undefined => {
  switch (item.type) {
    case 'command_execution':
      return { kind: 'COMMAND', name: 'bash' }
    case 'file_change':
      return { kind: 'EDIT', name: 'file_change' }
    case 'mcp_tool_call': {
      const server = typeof item.server === 'string' ? item.server : undefined
      const name = typeof item.tool === 'string' ? item.tool : undefined
      return {
        kind: 'MCP',
        name: server === undefined || name === undefined ? 'mcp_tool_call' : `${server}.${name}`,
      }
    }
    case 'web_search':
      return { kind: 'WEB', name: 'web_search' }
    default:
      return undefined
  }
}

const derivedSkills = (
  item: Record<string, unknown>,
  toolCallId: string,
): NormalizedCodexEvent[] => {
  if (item.type !== 'command_execution' || typeof item.command !== 'string') return []
  const names = new Set<string>()
  for (const match of item.command.matchAll(
    /(?:^|[\s'"\\/])skills[\\/]([a-z0-9]+(?:[._-][a-z0-9]+)*)[\\/]SKILL\.md\b/gu,
  )) {
    const skillName = match[1]
    if (skillName !== undefined && skillName.length <= 128) names.add(skillName)
  }
  return [...names].map((skillName) => ({
    type: 'AGENT_SKILL_INVOKED' as const,
    data: { skillName, evidence: 'DERIVED' as const, sourceToolCallId: toolCallId },
  }))
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
        const messageId = toolCallId(item)
        if (messageId === undefined || typeof item.text !== 'string') return [captured]
        const content = boundedContent(agentMessageContent(options.redactor.redact(item.text)))
        return content === undefined
          ? [captured]
          : [captured, { type: 'AGENT_MESSAGE', data: { messageId, content } }]
      }
      if (event.type === 'item.completed' && item.type === 'reasoning') {
        const messageId = toolCallId(item)
        if (messageId === undefined || typeof item.text !== 'string') return [captured]
        const content = boundedContent(options.redactor.redact(item.text))
        return content === undefined
          ? [captured]
          : [captured, { type: 'AGENT_REASONING', data: { messageId, content } }]
      }

      const id = toolCallId(item)
      const normalizedTool = tool(item)
      if (id === undefined || normalizedTool === undefined) return [captured]
      if (event.type === 'item.started') {
        return [
          captured,
          {
            type: 'AGENT_TOOL_STARTED',
            data: {
              toolCallId: id,
              toolKind: normalizedTool.kind,
              toolName: normalizedTool.name,
              input: toolInput(item, options.redactor),
            },
          },
          ...derivedSkills(item, id),
        ]
      }
      return [
        captured,
        {
          type: 'AGENT_TOOL_COMPLETED',
          data: {
            toolCallId: id,
            toolKind: normalizedTool.kind,
            toolName: normalizedTool.name,
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
