import type { AgentTraceEvent } from '@slopify/contracts'
import { BrainIcon, WrenchIcon } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent, MessageHeader } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'

interface AgentTranscriptProps {
  readonly events: readonly AgentTraceEvent[]
  readonly prompt: string
  readonly result?: unknown
  readonly streaming: boolean
}

type TranscriptItem =
  | {
      readonly id: string
      readonly kind: 'text'
      readonly source: 'reasoning' | 'result'
      content: string
    }
  | {
      readonly id: string
      readonly kind: 'tool'
      readonly toolCallId: string
      toolName: string
      input?: unknown
      status: 'running' | 'succeeded' | 'failed'
      updates: string[]
      result?: string
    }

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const appendMarkdownDelta = (current: string, next: string): string =>
  next.startsWith('**') && !/\s$/u.test(current) ? `${current}\n\n${next}` : current + next

const transcriptFrom = (events: readonly AgentTraceEvent[]): readonly TranscriptItem[] => {
  const items: TranscriptItem[] = []
  const tools = new Map<string, Extract<TranscriptItem, { kind: 'tool' }>>()
  let activeReasoning: Extract<TranscriptItem, { kind: 'text' }> | undefined
  let reasoningStreamOpen = false

  for (const event of events) {
    const data = record(event.data)
    if (data === undefined) continue
    if (event.type === 'PI_EVENT') {
      const piEvent = record(data.event)
      const assistantEvent = record(piEvent?.assistantMessageEvent)
      if (piEvent?.type === 'message_update' && assistantEvent?.type === 'thinking_start') {
        reasoningStreamOpen = true
        activeReasoning = undefined
      }
      if (piEvent?.type === 'message_update' && assistantEvent?.type === 'thinking_end') {
        reasoningStreamOpen = false
        activeReasoning = undefined
      }
      continue
    }
    if (event.type === 'AGENT_REASONING') {
      const content = text(data.content)
      if (content === undefined) continue
      const reasoning = activeReasoning ?? {
        id: `event-${event.sequence}`,
        kind: 'text',
        source: 'reasoning',
        content,
      }
      if (activeReasoning === undefined) items.push(reasoning)
      else activeReasoning.content = appendMarkdownDelta(activeReasoning.content, content)
      activeReasoning = reasoningStreamOpen ? reasoning : undefined
      continue
    }
    if (event.type === 'AGENT_RESULT') {
      const result = record(data.result)
      const summary = text(result?.summary)
      const previous = items.at(-1)
      if (summary !== undefined && (previous?.kind !== 'text' || previous.content !== summary))
        items.push({
          id: `event-${event.sequence}`,
          kind: 'text',
          source: 'result',
          content: summary,
        })
      continue
    }
    const toolCallId = text(data.toolCallId)
    if (toolCallId === undefined) continue
    if (event.type === 'AGENT_TOOL_STARTED') {
      const tool: Extract<TranscriptItem, { kind: 'tool' }> = {
        id: `tool-${toolCallId}`,
        kind: 'tool',
        toolCallId,
        toolName: text(data.toolName) ?? 'Tool',
        ...(data.input === undefined ? {} : { input: data.input }),
        status: 'running',
        updates: [],
      }
      tools.set(toolCallId, tool)
    }
    if (event.type === 'AGENT_TOOL_UPDATED') {
      const update = text(data.content)
      if (update !== undefined) tools.get(toolCallId)?.updates.push(update)
    }
    if (event.type === 'AGENT_TOOL_COMPLETED') {
      const existingTool = tools.get(toolCallId)
      const tool =
        existingTool ??
        ({
          id: `tool-${toolCallId}`,
          kind: 'tool',
          toolCallId,
          toolName: text(data.toolName) ?? 'Tool',
          status: 'succeeded',
          updates: [],
        } satisfies Extract<TranscriptItem, { kind: 'tool' }>)
      tool.toolName = text(data.toolName) ?? tool.toolName
      tool.status = data.status === 'failed' ? 'failed' : 'succeeded'
      const result = text(data.content)
      if (result !== undefined) tool.result = result
      if (existingTool === undefined) tools.set(toolCallId, tool)
      items.push(tool)
    }
  }
  return items
}

const resultResponse = (result: unknown): string | undefined => {
  const resultRecord = record(result)
  const data = record(resultRecord?.data)
  return text(data?.response) ?? text(resultRecord?.summary)
}

const liveAnnouncement = (events: readonly AgentTraceEvent[]): string => {
  const event = events.at(-1)
  const data = record(event?.data)
  if (event?.type === 'AGENT_REASONING') return 'Model reasoning updated'
  if (event?.type === 'AGENT_TOOL_COMPLETED') {
    return `${text(data?.toolName) ?? 'Tool'} ${data?.status === 'failed' ? 'failed' : 'completed'}`
  }
  if (event?.type === 'AGENT_RESULT') return 'Agent result received'
  return ''
}

function MarkdownContent({ children }: Readonly<{ children: string }>) {
  return (
    <div className="grid min-w-0 gap-3 text-sm/6 [&_blockquote]:border-l [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children: linkChildren, ...props }) => (
            <a
              {...props}
              className="font-medium underline underline-offset-4"
              rel="noreferrer"
              target="_blank"
            >
              {linkChildren}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  )
}

const plainTextFromMarkdown = (value: string): string =>
  value
    .replace(/```[^\n]*\n([\s\S]*?)```/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gmu, '')
    .replace(/(\*\*|__|~~)(.*?)\1/gu, '$2')
    .replace(/([*_])([^*_]+)\1/gu, '$2')
    .trim()

function ToolTrace({ tool }: Readonly<{ tool: Extract<TranscriptItem, { kind: 'tool' }> }>) {
  return (
    <Bubble variant="muted" data-message-kind="tool">
      <BubbleContent className="flex min-h-10 items-center gap-2 text-muted-foreground">
        <WrenchIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 truncate text-sm/5">
          Used <span className="font-medium text-foreground">{tool.toolName}</span>
        </span>
        {tool.status === 'failed' ? (
          <span className="text-xs/5 text-destructive">Failed</span>
        ) : null}
      </BubbleContent>
    </Bubble>
  )
}

function ReasoningBubble({ content }: Readonly<{ content: string }>) {
  return (
    <Bubble variant="muted" data-message-kind="reasoning">
      <BubbleContent className="grid gap-2.5">
        <div className="flex items-center gap-2 text-xs/5 font-medium text-muted-foreground">
          <BrainIcon aria-hidden="true" className="size-4" />
          <span>Reasoning</span>
        </div>
        <p className="whitespace-pre-wrap text-sm/6">{plainTextFromMarkdown(content)}</p>
      </BubbleContent>
    </Bubble>
  )
}

export function AgentTranscript({ events, prompt, result, streaming }: AgentTranscriptProps) {
  const transcript = transcriptFrom(events)
  const hasResponse = transcript.some((item) => item.kind === 'text' && item.source === 'result')
  const hasResult = events.some(({ type }) => type === 'AGENT_RESULT')
  const fallbackResponse = hasResponse || hasResult ? undefined : resultResponse(result)
  const announcement = liveAnnouncement(events)
  const announcementSequence = events.at(-1)?.sequence

  return (
    <MessageScrollerProvider>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement === '' ? null : <span key={announcementSequence}>{announcement}</span>}
      </span>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="gap-5 p-4">
            <MessageScrollerItem messageId="human-prompt" scrollAnchor>
              <Message align="end">
                <MessageContent>
                  <MessageHeader>Prompt</MessageHeader>
                  <Bubble variant="secondary">
                    <BubbleContent>
                      <MarkdownContent>{prompt}</MarkdownContent>
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            </MessageScrollerItem>

            <MessageScrollerItem messageId="agent-trace">
              <Message>
                <MessageContent>
                  <MessageHeader>Pi agent</MessageHeader>
                  {transcript.map((item) =>
                    item.kind === 'tool' ? (
                      <ToolTrace key={item.id} tool={item} />
                    ) : item.source === 'reasoning' ? (
                      <ReasoningBubble key={item.id} content={item.content} />
                    ) : (
                      <Bubble key={item.id} variant="muted" data-message-kind="result">
                        <BubbleContent>
                          <MarkdownContent>{item.content}</MarkdownContent>
                        </BubbleContent>
                      </Bubble>
                    ),
                  )}
                  {fallbackResponse === undefined ? null : (
                    <Bubble variant="muted" data-message-kind="result">
                      <BubbleContent>
                        <MarkdownContent>{fallbackResponse}</MarkdownContent>
                      </BubbleContent>
                    </Bubble>
                  )}
                  {transcript.length === 0 && fallbackResponse === undefined ? (
                    <p className="text-sm/5 text-muted-foreground" aria-live="polite">
                      {streaming ? 'Waiting for the first agent event…' : 'No trace was recorded.'}
                    </p>
                  ) : null}
                </MessageContent>
              </Message>
            </MessageScrollerItem>
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
