import type { RunEvent } from '@loop/contracts'
import type { WorkflowNode } from '@loop/workflow-model'
import { BrainIcon } from 'lucide-react'

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

interface AgentOutputChunk {
  readonly kind: 'reasoning' | 'response'
  readonly content: string
}

const parseOutput = (content: string): AgentOutputChunk | undefined => {
  try {
    const parsed = JSON.parse(content) as unknown
    if (typeof parsed !== 'object' || parsed === null || !('eventType' in parsed)) return undefined
    const eventType = parsed.eventType
    const data = 'data' in parsed ? parsed.data : undefined
    if (typeof data !== 'object' || data === null || !('content' in data)) return undefined
    const chunk = data.content
    if (typeof chunk !== 'string') return undefined
    if (eventType === 'AGENT_REASONING') return { kind: 'reasoning', content: chunk }
    if (eventType === 'AGENT_MESSAGE') return { kind: 'response', content: chunk }
    return undefined
  } catch {
    return { kind: 'response', content }
  }
}

const transcriptFrom = (events: readonly RunEvent[], nodeId: string) => {
  let reasoning = ''
  let response = ''
  for (const event of events) {
    if (event.type !== 'NODE_OUTPUT' || event.nodeId !== nodeId || event.data.channel !== 'agent')
      continue
    const chunk = parseOutput(event.data.content)
    if (chunk?.kind === 'reasoning') reasoning += chunk.content
    if (chunk?.kind === 'response') response += chunk.content
  }
  return { reasoning, response }
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

  const artifacts = 'artifacts' in result && Array.isArray(result.artifacts) ? result.artifacts : []
  const finalization = artifacts.find(
    (artifact) => stringProperty(artifact, 'type') === 'FINALIZATION',
  )
  return stringProperty(finalization, 'content') ?? stringProperty(result, 'summary')
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
