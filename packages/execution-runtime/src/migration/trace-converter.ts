import { AgentExecutionEventSchema } from '@slopify/contracts'

import {
  AgentTraceStoreError,
  createFilesystemAgentTraceStore,
  createRunFilesystemAgentTraceStore,
} from '../traces/filesystem-agent-trace-store.js'
import type { SlopifyPaths } from '../filesystem/slopify-home.js'

export interface LegacyTraceConversionInput {
  readonly workflowId: string
  readonly runId: string
  readonly nodeExecutionId: string
  readonly attemptId: string
  readonly executionIndex: number
}

export interface LegacyTraceConverter {
  convert(input: LegacyTraceConversionInput): Promise<boolean>
}

export const createLegacyTraceConverter = (options: {
  readonly legacyTracesRoot: string
  readonly paths: Pick<SlopifyPaths, 'run'>
}): LegacyTraceConverter => {
  const source = createFilesystemAgentTraceStore({ root: options.legacyTracesRoot })
  const destination = createRunFilesystemAgentTraceStore({ paths: options.paths })

  return {
    async convert(input) {
      let trace
      try {
        trace = await source.read(input)
      } catch (cause) {
        if (cause instanceof AgentTraceStoreError && cause.code === 'TRACE_NOT_FOUND') return false
        throw cause
      }
      const context = {
        workflowId: input.workflowId,
        executionIndex: input.executionIndex,
        header: trace.header,
      }
      await destination.start(context)
      for (const event of trace.events) {
        await destination.append(
          context,
          AgentExecutionEventSchema.parse({
            executionId: trace.header.nodeExecutionId,
            runId: trace.header.runId,
            nodeId: trace.header.nodeId,
            timestamp: event.timestamp,
            type: event.type,
            data: event.data,
          }),
        )
      }
      return true
    },
  }
}
