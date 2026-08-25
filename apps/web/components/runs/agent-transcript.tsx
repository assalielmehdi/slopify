'use client'

import type { AgentTraceEvent } from '@slopify/contracts'
import { BookOpenIcon, BrainIcon, ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Message, MessageContent, MessageHeader } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { formatDuration } from '@/lib/run-format'

import { AgentTraceToolBlock, type AgentTraceTool } from './agent-trace-tool'

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
  | ({
      readonly id: string
      readonly kind: 'tool'
    } & AgentTraceTool)
  | {
      readonly id: string
      readonly kind: 'skill'
      readonly skillName: string
      readonly evidence: 'DIRECT' | 'DERIVED'
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
    if (event.type === 'HARNESS_EVENT') {
      const harnessEvent = record(data.event)
      const assistantEvent = record(harnessEvent?.assistantMessageEvent)
      if (harnessEvent?.type === 'message_update' && assistantEvent?.type === 'thinking_start') {
        reasoningStreamOpen = true
        activeReasoning = undefined
      }
      if (harnessEvent?.type === 'message_update' && assistantEvent?.type === 'thinking_end') {
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
    if (event.type === 'AGENT_SKILL_INVOKED') {
      const skillName = text(data.skillName)
      if (skillName === undefined) continue
      items.push({
        id: `event-${event.sequence}`,
        kind: 'skill',
        skillName,
        evidence: data.evidence === 'DIRECT' ? 'DIRECT' : 'DERIVED',
      })
      continue
    }
    const toolCallId = text(data.toolCallId)
    if (toolCallId === undefined) continue
    if (event.type === 'AGENT_TOOL_STARTED') {
      const existingTool = tools.get(toolCallId)
      if (existingTool !== undefined) {
        existingTool.toolName = text(data.toolName) ?? existingTool.toolName
        if (data.input !== undefined) existingTool.input = data.input
        continue
      }
      const tool: Extract<TranscriptItem, { kind: 'tool' }> = {
        id: `tool-${toolCallId}`,
        kind: 'tool',
        toolCallId,
        toolName: text(data.toolName) ?? 'Tool',
        ...(data.input === undefined ? {} : { input: data.input }),
        status: 'running',
        updates: [],
        startedAt: event.timestamp,
      }
      tools.set(toolCallId, tool)
      items.push(tool)
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
      tool.completedAt = event.timestamp
      const result = text(data.content)
      if (result !== undefined) tool.result = result
      if (existingTool === undefined) {
        tools.set(toolCallId, tool)
        items.push(tool)
      }
    }
  }
  return items
}

const resultResponse = (result: unknown): string | undefined => {
  const resultRecord = record(result)
  const data = record(resultRecord?.data)
  return text(data?.response) ?? text(resultRecord?.summary)
}

const durationFrom = (events: readonly AgentTraceEvent[]): number | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'AGENT_RESULT') continue
    const durationMs = record(event.data)?.durationMs
    return typeof durationMs === 'number' ? durationMs : undefined
  }
  return undefined
}

const liveAnnouncement = (events: readonly AgentTraceEvent[]): string => {
  const event = events.at(-1)
  const data = record(event?.data)
  if (event?.type === 'AGENT_REASONING') return 'Model reasoning updated'
  if (event?.type === 'AGENT_TOOL_COMPLETED') {
    return `${text(data?.toolName) ?? 'Tool'} ${data?.status === 'failed' ? 'failed' : 'completed'}`
  }
  if (event?.type === 'AGENT_SKILL_INVOKED') {
    return `${text(data?.skillName) ?? 'Skill'} invoked`
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

function ReasoningLine({ content }: Readonly<{ content: string }>) {
  return (
    <div
      className="flex min-w-0 items-start gap-2 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
      data-message-kind="reasoning"
    >
      <BrainIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 whitespace-pre-wrap text-sm/6 wrap-break-word">
        {plainTextFromMarkdown(content)}
      </p>
    </div>
  )
}

function SkillLine({
  evidence,
  skillName,
}: Readonly<{ evidence: 'DIRECT' | 'DERIVED'; skillName: string }>) {
  return (
    <div
      className="flex min-w-0 items-start gap-2 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
      data-message-kind="skill"
    >
      <BookOpenIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="break-words font-mono text-sm/6">{skillName}</p>
        <p className="text-xs/4 text-muted-foreground">
          {evidence === 'DIRECT' ? 'Direct' : 'Derived'} skill invocation
        </p>
      </div>
    </div>
  )
}

export function AgentTranscript({ events, prompt, result, streaming }: AgentTranscriptProps) {
  const [workOpen, setWorkOpen] = useState(false)
  const transcript = transcriptFrom(events)
  const workItems = transcript.filter(
    (item) =>
      item.kind === 'tool' ||
      item.kind === 'skill' ||
      (item.kind === 'text' && item.source === 'reasoning'),
  )
  const results = transcript.filter(
    (item): item is Extract<TranscriptItem, { kind: 'text' }> =>
      item.kind === 'text' && item.source === 'result',
  )
  const hasResponse = transcript.some((item) => item.kind === 'text' && item.source === 'result')
  const hasResult = events.some(({ type }) => type === 'AGENT_RESULT')
  const fallbackResponse = hasResponse || hasResult ? undefined : resultResponse(result)
  const announcement = liveAnnouncement(events)
  const announcementSequence = events.at(-1)?.sequence
  const durationMs = durationFrom(events)
  const workLabel =
    durationMs === undefined ? 'Work details' : `Worked for ${formatDuration(durationMs)}`

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
                  <MessageHeader>Agent</MessageHeader>
                  {workItems.length > 0 || durationMs !== undefined ? (
                    <Collapsible
                      className="t-acc w-full"
                      data-open={workOpen}
                      open={workOpen}
                      onOpenChange={setWorkOpen}
                    >
                      <CollapsibleTrigger className="flex min-h-10 w-full items-center gap-2 border-b text-left text-sm/5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30">
                        <span>{workLabel}</span>
                        <ChevronRightIcon
                          aria-hidden="true"
                          className="t-acc-chevron size-4 shrink-0"
                        />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="t-acc-panel">
                        <div className="t-acc-panel-inner">
                          <div className="pt-3">
                            {workItems.map((item) =>
                              item.kind === 'text' ? (
                                <ReasoningLine key={item.id} content={item.content} />
                              ) : item.kind === 'skill' ? (
                                <SkillLine
                                  evidence={item.evidence}
                                  key={item.id}
                                  skillName={item.skillName}
                                />
                              ) : (
                                <AgentTraceToolBlock key={item.id} tool={item} />
                              ),
                            )}
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : null}
                  {results.map((item) => (
                    <Bubble key={item.id} variant="muted" data-message-kind="result">
                      <BubbleContent>
                        <MarkdownContent>{item.content}</MarkdownContent>
                      </BubbleContent>
                    </Bubble>
                  ))}
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
