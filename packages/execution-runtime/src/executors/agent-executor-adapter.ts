import type {
  AgentExecutionEvent,
  AgentExecutionInput,
  AgentExecutor,
  AgentNodeResult,
} from '@loop/agent-runtimes'

import type { RunRepository } from '../persistence/run-repository.js'
import type { NodeExecutionContext } from './registry.js'

const MAX_OUTPUT_CHUNK_LENGTH = 65_536

export type AgentExecutorAdapterResult =
  | Readonly<{ status: 'succeeded'; result: AgentNodeResult }>
  | Readonly<{ status: 'failed'; code: string; message: string }>
  | Readonly<{ status: 'cancelled'; reason: string }>

export interface AgentExecutorAdapter {
  execute(
    context: NodeExecutionContext,
    input: AgentExecutionInput,
  ): Promise<AgentExecutorAdapterResult>
}

export interface CreateAgentExecutorAdapterOptions {
  readonly agent: AgentExecutor
  readonly runs: RunRepository
}

const observableContent = (event: AgentExecutionEvent): string | undefined => {
  switch (event.type) {
    case 'AGENT_SESSION_IDENTIFIED':
      return `Session identified: ${event.data.sessionId}`
    case 'AGENT_MESSAGE':
      return event.data.content
    case 'AGENT_TOOL_STARTED':
      return `Tool started: ${event.data.toolName} (${event.data.toolCallId})`
    case 'AGENT_TOOL_UPDATED':
      return `Tool update (${event.data.toolCallId}): ${event.data.content}`
    case 'AGENT_TOOL_COMPLETED':
      return `Tool ${event.data.status}: ${event.data.toolName} (${event.data.toolCallId})\n${event.data.content}`
    case 'AGENT_STARTED':
    case 'AGENT_RESULT':
    case 'AGENT_FAILED':
    case 'AGENT_CANCELLED':
      return undefined
  }
}

export const createAgentExecutorAdapter = (
  options: CreateAgentExecutorAdapterOptions,
): AgentExecutorAdapter => ({
  async execute(context, input) {
    if (context.signal.aborted) {
      return { status: 'cancelled', reason: 'Cancellation requested' }
    }

    let terminal: AgentExecutorAdapterResult | undefined
    const requestCancellation = (): void => {
      void options.agent.cancel(input.executionId).catch(() => undefined)
    }
    context.signal.addEventListener('abort', requestCancellation, { once: true })

    try {
      for await (const event of options.agent.execute(input)) {
        if (
          event.executionId !== input.executionId ||
          event.runId !== input.runId ||
          event.nodeId !== input.nodeId ||
          terminal !== undefined
        ) {
          return {
            status: 'failed',
            code: 'AGENT_EVENT_SEQUENCE_INVALID',
            message: 'Agent event sequence is invalid',
          }
        }

        const content = observableContent(event)
        if (content !== undefined) {
          for (let offset = 0; offset < content.length; offset += MAX_OUTPUT_CHUNK_LENGTH) {
            options.runs.recordOutput({
              runId: context.run.runId,
              nodeExecutionId: context.nodeExecutionId,
              nodeId: context.node.id,
              channel: 'agent',
              content: content.slice(offset, offset + MAX_OUTPUT_CHUNK_LENGTH),
              timestamp: event.timestamp,
            })
          }
        }

        if (event.type === 'AGENT_RESULT') {
          terminal = { status: 'succeeded', result: event.data.result }
        } else if (event.type === 'AGENT_FAILED') {
          terminal = {
            status: 'failed',
            code: event.data.code,
            message: event.data.message,
          }
        } else if (event.type === 'AGENT_CANCELLED') {
          terminal = { status: 'cancelled', reason: event.data.reason }
        }
      }
    } finally {
      context.signal.removeEventListener('abort', requestCancellation)
    }

    return (
      terminal ?? {
        status: 'failed',
        code: 'AGENT_RESULT_MISSING',
        message: 'Agent execution ended without a terminal result',
      }
    )
  },
})
