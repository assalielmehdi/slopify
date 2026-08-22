import type { AgentTraceEvent } from '@slopify/contracts'
import { BrainIcon, ChevronDownIcon, WrenchIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Message, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message'
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
  | { readonly id: string; readonly kind: 'reasoning' | 'message'; content: string }
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

const transcriptFrom = (events: readonly AgentTraceEvent[]): readonly TranscriptItem[] => {
  const items: TranscriptItem[] = []
  const tools = new Map<string, Extract<TranscriptItem, { kind: 'tool' }>>()

  for (const event of events) {
    const data = record(event.data)
    if (data === undefined) continue
    if (event.type === 'AGENT_MESSAGE' || event.type === 'AGENT_REASONING') {
      const content = text(data.content)
      if (content === undefined) continue
      const kind = event.type === 'AGENT_REASONING' ? 'reasoning' : 'message'
      const previous = items.at(-1)
      if (previous?.kind === kind) previous.content += content
      else items.push({ id: `event-${event.sequence}`, kind, content })
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
      items.push(tool)
    }
    if (event.type === 'AGENT_TOOL_UPDATED') {
      const update = text(data.content)
      if (update !== undefined) tools.get(toolCallId)?.updates.push(update)
    }
    if (event.type === 'AGENT_TOOL_COMPLETED') {
      const tool = tools.get(toolCallId)
      if (tool === undefined) continue
      tool.toolName = text(data.toolName) ?? tool.toolName
      tool.status = data.status === 'failed' ? 'failed' : 'succeeded'
      const result = text(data.content)
      if (result !== undefined) tool.result = result
    }
  }
  return items
}

const resultResponse = (result: unknown): string | undefined => {
  const resultRecord = record(result)
  const data = record(resultRecord?.data)
  return text(data?.response) ?? text(resultRecord?.summary)
}

const formattedJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return 'Input unavailable'
  }
}

const liveAnnouncement = (events: readonly AgentTraceEvent[]): string => {
  const event = events.at(-1)
  const data = record(event?.data)
  if (event?.type === 'AGENT_MESSAGE') return 'Agent message updated'
  if (event?.type === 'AGENT_REASONING') return 'Model reasoning updated'
  if (event?.type === 'AGENT_TOOL_STARTED') return `${text(data?.toolName) ?? 'Tool'} started`
  if (event?.type === 'AGENT_TOOL_UPDATED') return 'Tool progress updated'
  if (event?.type === 'AGENT_TOOL_COMPLETED') {
    return `${text(data?.toolName) ?? 'Tool'} ${data?.status === 'failed' ? 'failed' : 'completed'}`
  }
  return ''
}

function ReasoningTrace({ content, streaming }: Readonly<{ content: string; streaming: boolean }>) {
  return (
    <Collapsible defaultOpen={streaming}>
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
        <BrainIcon aria-hidden="true" className="size-3.5" />
        <span>{streaming ? 'Reasoning…' : 'Model reasoning'}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-3.5 transition-transform group-data-panel-open:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 border-l pl-3 text-xs/5 whitespace-pre-wrap text-muted-foreground">
        {content}
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolTrace({ tool }: Readonly<{ tool: Extract<TranscriptItem, { kind: 'tool' }> }>) {
  return (
    <Collapsible
      defaultOpen={tool.status !== 'succeeded'}
      className="rounded-lg border bg-background"
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-2 p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
        <WrenchIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs/4 font-medium">
          {tool.toolName}
        </span>
        <Badge
          variant={tool.status === 'failed' ? 'destructive' : 'outline'}
          className={
            tool.status === 'succeeded' ? 'bg-status-success/10 text-status-success' : undefined
          }
        >
          {tool.status === 'running'
            ? 'Running'
            : tool.status === 'succeeded'
              ? 'Succeeded'
              : 'Failed'}
        </Badge>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-3.5 text-muted-foreground transition-transform group-data-panel-open:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 border-t p-3">
        {tool.input === undefined ? null : (
          <div className="grid gap-1.5">
            <p className="text-[11px]/4 font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Input
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs/5 whitespace-pre-wrap">
              {formattedJson(tool.input)}
            </pre>
          </div>
        )}
        {tool.updates.length === 0 ? null : (
          <div className="grid gap-1.5">
            <p className="text-[11px]/4 font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Progress
            </p>
            <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs/5 whitespace-pre-wrap text-muted-foreground">
              {tool.updates.join('')}
            </pre>
          </div>
        )}
        {tool.result === undefined ? null : (
          <div className="grid gap-1.5">
            <p className="text-[11px]/4 font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {tool.status === 'failed' ? 'Error' : 'Output'}
            </p>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs/5 whitespace-pre-wrap">
              {tool.result}
            </pre>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function AgentTranscript({ events, prompt, result, streaming }: AgentTranscriptProps) {
  const transcript = transcriptFrom(events)
  const hasMessage = transcript.some(({ kind }) => kind === 'message')
  const fallbackResponse = hasMessage ? undefined : resultResponse(result)
  const announcement = liveAnnouncement(events)
  const announcementSequence = events.at(-1)?.sequence

  return (
    <MessageScrollerProvider>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement === '' ? null : <span key={announcementSequence}>{announcement}</span>}
      </span>
      <MessageScroller className="min-h-0 flex-1 rounded-lg border">
        <MessageScrollerViewport>
          <MessageScrollerContent className="gap-5 p-4">
            <MessageScrollerItem messageId="human-prompt" scrollAnchor>
              <Message align="end">
                <MessageContent>
                  <MessageHeader>Prompt</MessageHeader>
                  <Bubble variant="secondary">
                    <BubbleContent className="whitespace-pre-wrap">{prompt}</BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            </MessageScrollerItem>

            <MessageScrollerItem messageId="agent-trace">
              <Message>
                <MessageContent>
                  <MessageHeader>Pi agent</MessageHeader>
                  {transcript.map((item) =>
                    item.kind === 'reasoning' ? (
                      <ReasoningTrace key={item.id} content={item.content} streaming={streaming} />
                    ) : item.kind === 'tool' ? (
                      <ToolTrace key={item.id} tool={item} />
                    ) : (
                      <Bubble key={item.id} variant="ghost">
                        <BubbleContent className="whitespace-pre-wrap">
                          {item.content}
                        </BubbleContent>
                      </Bubble>
                    ),
                  )}
                  {fallbackResponse === undefined ? null : (
                    <Bubble variant="ghost">
                      <BubbleContent className="whitespace-pre-wrap">
                        {fallbackResponse}
                      </BubbleContent>
                    </Bubble>
                  )}
                  {transcript.length === 0 && fallbackResponse === undefined ? (
                    <p className="text-sm/5 text-muted-foreground" aria-live="polite">
                      {streaming ? 'Waiting for the first agent event…' : 'No trace was recorded.'}
                    </p>
                  ) : null}
                  <MessageFooter>{streaming ? 'Live trace' : 'Recorded trace'}</MessageFooter>
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
