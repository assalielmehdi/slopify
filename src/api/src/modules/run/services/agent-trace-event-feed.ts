import { RunIdSchema, type AgentTraceEvent } from '@slopify/shared'

import type { FilesystemRunReader } from '../runs/run-index.js'
import {
  AgentTraceStoreError,
  type RunAgentTraceReadInput,
  type RunAgentTraceStore,
} from '../traces/filesystem-agent-trace-store.js'

export interface SubscribeToAgentTraceEventsInput {
  readonly runId: string
  readonly nodeExecutionId: string
  readonly attemptId: string
  readonly afterSequence?: number
  readonly signal?: AbortSignal
}

export interface FilesystemAgentTraceEventFeed {
  subscribe(input: SubscribeToAgentTraceEventsInput): AsyncIterable<AgentTraceEvent>
}

const waitForPoll =
  (milliseconds: number) =>
  (signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return Promise.resolve()
    return new Promise((resolve) => {
      const onAbort = (): void => {
        clearTimeout(timeout)
        signal.removeEventListener('abort', onAbort)
        resolve()
      }
      const timeout = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, milliseconds)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }

export const createFilesystemAgentTraceEventFeed = (options: {
  readonly reader: Pick<FilesystemRunReader, 'get'>
  readonly traces: Pick<RunAgentTraceStore, 'read'>
  readonly pollIntervalMs?: number
  readonly wait?: (signal: AbortSignal) => Promise<void>
}): FilesystemAgentTraceEventFeed => {
  const pollIntervalMs = options.pollIntervalMs ?? 100
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 60_000) {
    throw new AgentTraceStoreError('TRACE_REQUEST_INVALID', 'Trace poll interval is invalid')
  }
  const wait = options.wait ?? waitForPoll(pollIntervalMs)

  return {
    subscribe(input) {
      const runId = RunIdSchema.parse(input.runId)
      const afterSequence = input.afterSequence ?? 0
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        throw new AgentTraceStoreError('TRACE_REQUEST_INVALID', 'Trace event cursor is invalid')
      }
      const signal = input.signal ?? new AbortController().signal

      return {
        async *[Symbol.asyncIterator]() {
          const detail = await options.reader.get(runId)
          const execution =
            detail?.status === 'READY'
              ? detail.executions.find(
                  (candidate) =>
                    candidate.nodeExecutionId === input.nodeExecutionId &&
                    candidate.attemptId === input.attemptId,
                )
              : undefined
          if (execution === undefined || detail?.status !== 'READY') {
            throw new AgentTraceStoreError('TRACE_NOT_FOUND', 'Agent trace was not found')
          }
          const traceInput: RunAgentTraceReadInput = {
            workflowId: detail.run.workflowId,
            executionIndex: execution.executionIndex,
            runId,
            nodeExecutionId: input.nodeExecutionId,
            attemptId: input.attemptId,
          }
          let cursor = afterSequence
          let observedTrace = false

          while (!signal.aborted) {
            let trace
            try {
              trace = await options.traces.read(traceInput)
              observedTrace = true
            } catch (cause) {
              if (
                cause instanceof AgentTraceStoreError &&
                cause.code === 'TRACE_NOT_FOUND' &&
                !observedTrace
              ) {
                await wait(signal)
                continue
              }
              throw cause
            }
            if (cursor > trace.events.length) {
              throw new AgentTraceStoreError(
                'TRACE_REQUEST_INVALID',
                'Trace event cursor is invalid',
              )
            }
            for (const event of trace.events) {
              if (event.sequence <= cursor) continue
              cursor = event.sequence
              yield event
              if (signal.aborted) return
            }
            if (trace.complete) return
            await wait(signal)
          }
        },
      }
    },
  }
}
