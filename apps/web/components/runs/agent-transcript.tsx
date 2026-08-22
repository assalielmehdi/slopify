import type { RunEvent } from '@loop/contracts'
import type { WorkflowNode } from '@loop/workflow-model'
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

type AgentNode = Extract<WorkflowNode, { type: 'agent' }>

interface AgentTranscriptProps {
  readonly events: readonly RunEvent[]
  readonly node: AgentNode
  readonly result?: unknown
  readonly streaming: boolean
}

type AgentOutputChunk =
  | Readonly<{ kind: 'reasoning' | 'response'; content: string }>
  | Readonly<{ kind: 'tool-started'; toolCallId: string; toolName: string }>
  | Readonly<{ kind: 'tool-updated'; toolCallId: string; content: string }>
  | Readonly<{
      kind: 'tool-completed'
      toolCallId: string
      toolName: string
      status: 'succeeded' | 'failed'
      content: string
    }>

interface ToolTranscriptEntry {
  readonly toolCallId: string
  readonly toolName: string
  readonly status: 'running' | 'succeeded' | 'failed'
  readonly updates: readonly string[]
  readonly result?: string
}

const objectProperty = (value: unknown, key: string): unknown => {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined
  return value[key as keyof typeof value]
}

const requiredString = (value: unknown, key: string): string | undefined => {
  const candidate = objectProperty(value, key)
  return typeof candidate === 'string' && candidate !== '' ? candidate : undefined
}

const parsePlainToolOutput = (content: string): AgentOutputChunk | undefined => {
  const started = /^Tool started: (.+) \(([^)]+)\)$/.exec(content)
  if (started !== null) {
    const [, toolName, toolCallId] = started
    if (toolName !== undefined && toolCallId !== undefined)
      return { kind: 'tool-started', toolName, toolCallId }
  }

  const updated = /^Tool update \(([^)]+)\): ([\s\S]+)$/.exec(content)
  if (updated !== null) {
    const [, toolCallId, update] = updated
    if (toolCallId !== undefined && update !== undefined)
      return { kind: 'tool-updated', toolCallId, content: update }
  }

  const completed = /^Tool (succeeded|failed): (.+) \(([^)]+)\)\n([\s\S]*)$/.exec(content)
  if (completed !== null) {
    const [, status, toolName, toolCallId, result] = completed
    if (
      (status === 'succeeded' || status === 'failed') &&
      toolName !== undefined &&
      toolCallId !== undefined &&
      result !== undefined
    )
      return { kind: 'tool-completed', status, toolName, toolCallId, content: result }
  }

  return undefined
}

const parseOutput = (content: string): AgentOutputChunk | undefined => {
  try {
    const parsed = JSON.parse(content) as unknown
    if (typeof parsed !== 'object' || parsed === null || !('eventType' in parsed)) return undefined
    const eventType = parsed.eventType
    const data = objectProperty(parsed, 'data')
    const chunkContent = requiredString(data, 'content')
    if (eventType === 'AGENT_REASONING' && chunkContent !== undefined)
      return { kind: 'reasoning', content: chunkContent }
    if (eventType === 'AGENT_MESSAGE' && chunkContent !== undefined)
      return { kind: 'response', content: chunkContent }
    const toolCallId = requiredString(data, 'toolCallId')
    if (toolCallId === undefined) return undefined
    if (eventType === 'AGENT_TOOL_STARTED') {
      const toolName = requiredString(data, 'toolName')
      return toolName === undefined ? undefined : { kind: 'tool-started', toolCallId, toolName }
    }
    if (eventType === 'AGENT_TOOL_UPDATED') {
      return chunkContent === undefined
        ? undefined
        : { kind: 'tool-updated', toolCallId, content: chunkContent }
    }
    if (eventType === 'AGENT_TOOL_COMPLETED') {
      const toolName = requiredString(data, 'toolName')
      const status = objectProperty(data, 'status')
      if (
        toolName === undefined ||
        chunkContent === undefined ||
        (status !== 'succeeded' && status !== 'failed')
      ) {
        return undefined
      }
      return {
        kind: 'tool-completed',
        toolCallId,
        toolName,
        status,
        content: chunkContent,
      }
    }
    return undefined
  } catch {
    return parsePlainToolOutput(content) ?? { kind: 'response', content }
  }
}

const transcriptFrom = (events: readonly RunEvent[], nodeId: string) => {
  let reasoning = ''
  let response = ''
  const tools = new Map<string, ToolTranscriptEntry>()
  for (const event of events) {
    if (event.type !== 'NODE_OUTPUT' || event.nodeId !== nodeId || event.data.channel !== 'agent')
      continue
    const chunk = parseOutput(event.data.content)
    if (chunk?.kind === 'reasoning') reasoning += chunk.content
    if (chunk?.kind === 'response') response += chunk.content
    if (chunk?.kind === 'tool-started') {
      tools.set(chunk.toolCallId, {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        status: 'running',
        updates: [],
      })
    }
    if (chunk?.kind === 'tool-updated') {
      const current = tools.get(chunk.toolCallId)
      tools.set(chunk.toolCallId, {
        toolCallId: chunk.toolCallId,
        toolName: current?.toolName ?? 'Tool',
        status: current?.status ?? 'running',
        updates: [...(current?.updates ?? []), chunk.content],
        ...(current?.result === undefined ? {} : { result: current.result }),
      })
    }
    if (chunk?.kind === 'tool-completed') {
      const current = tools.get(chunk.toolCallId)
      tools.set(chunk.toolCallId, {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        status: chunk.status,
        updates: current?.updates ?? [],
        result: chunk.content,
      })
    }
  }
  return { reasoning, response, tools: [...tools.values()] }
}

const stringProperty = (value: unknown, key: string): string | undefined => {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined
  const candidate = value[key as keyof typeof value]
  return typeof candidate === 'string' ? candidate : undefined
}

const resultResponse = (result: unknown): string | undefined => {
  if (typeof result !== 'object' || result === null) return undefined
  const data = 'data' in result ? result.data : undefined
  const response = stringProperty(data, 'response')
  if (response !== undefined) return response
  return stringProperty(result, 'summary')
}

export function AgentTranscript({ events, node, result, streaming }: AgentTranscriptProps) {
  const transcript = transcriptFrom(events, node.id)
  const response = transcript.response || resultResponse(result) || ''

  return (
    <MessageScrollerProvider>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="p-4">
            <MessageScrollerItem messageId="human-prompt" scrollAnchor>
              <Message align="end">
                <MessageContent>
                  <MessageHeader>You</MessageHeader>
                  <Bubble variant="secondary">
                    <BubbleContent className="whitespace-pre-wrap">{node.job.prompt}</BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            </MessageScrollerItem>

            <MessageScrollerItem messageId="agent-response">
              <Message>
                <MessageContent>
                  <MessageHeader>Pi agent</MessageHeader>
                  {transcript.reasoning === '' ? null : (
                    <Collapsible defaultOpen>
                      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <BrainIcon aria-hidden="true" className="size-3.5" />
                        Reasoning
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 border-l pl-3 text-xs/5 whitespace-pre-wrap text-muted-foreground">
                        {transcript.reasoning}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                  {transcript.tools.length === 0 ? null : (
                    <div className="grid gap-2" aria-label="Tool activity">
                      {transcript.tools.map((tool) => (
                        <Collapsible
                          key={tool.toolCallId}
                          defaultOpen
                          className="rounded-md border bg-background transition-colors hover:bg-muted/35"
                        >
                          <CollapsibleTrigger className="group flex w-full items-center gap-2 p-3 text-left">
                            <WrenchIcon
                              aria-hidden="true"
                              className="size-3.5 text-muted-foreground"
                            />
                            <span className="min-w-0 flex-1 truncate font-mono text-xs/4 font-medium">
                              {tool.toolName}
                            </span>
                            <Badge
                              variant={tool.status === 'failed' ? 'destructive' : 'outline'}
                              className={
                                tool.status === 'succeeded'
                                  ? 'border-status-success/25 bg-status-success/10 text-status-success'
                                  : undefined
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
                          <CollapsibleContent className="border-t px-3 py-2">
                            <div className="grid gap-2 text-xs/5 whitespace-pre-wrap text-muted-foreground">
                              {tool.updates.map((update, index) => (
                                <p key={`${tool.toolCallId}:update:${index}`}>{update}</p>
                              ))}
                              {tool.result === undefined ? null : (
                                <p className="text-foreground">{tool.result}</p>
                              )}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                    </div>
                  )}
                  <Bubble variant="ghost">
                    <BubbleContent className="whitespace-pre-wrap" aria-live="polite">
                      {response === ''
                        ? streaming
                          ? 'Waiting for Pi…'
                          : 'No response was recorded.'
                        : response}
                    </BubbleContent>
                  </Bubble>
                  <MessageFooter>{streaming ? 'Streaming' : 'Recorded output'}</MessageFooter>
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
