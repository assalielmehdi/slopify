import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  AgentExecutionEventSchema,
  type AgentExecutionEvent,
  AgentTraceEventSchema,
  AgentTraceHeaderSchema,
  AgentTraceSchema,
  type AgentTrace,
  type AgentTraceHeader,
} from '@slopify/shared'
import { z } from 'zod'

import type { SlopifyPaths } from '../../../platform/filesystem/slopify-home.js'
import { resolveNodeExecutionPaths } from '../runs/run-layout.js'

const MAX_TRACE_BYTES = 67_108_864
const MAX_RECORD_BYTES = 2_097_152
const terminalTypes = new Set(['AGENT_RESULT', 'AGENT_FAILED', 'AGENT_CANCELLED'])

const headerRecordSchema = z.strictObject({
  kind: z.literal('header'),
  header: AgentTraceHeaderSchema,
})
const eventRecordSchema = z.strictObject({
  kind: z.literal('event'),
  event: AgentTraceEventSchema,
})
const recordSchema = z.discriminatedUnion('kind', [headerRecordSchema, eventRecordSchema])

export type AgentTraceStoreErrorCode =
  | 'TRACE_ALREADY_EXISTS'
  | 'TRACE_CORRUPT'
  | 'TRACE_NOT_FOUND'
  | 'TRACE_REQUEST_INVALID'
  | 'TRACE_TOO_LARGE'
  | 'TRACE_UNAVAILABLE'

export class AgentTraceStoreError extends Error {
  override readonly name = 'AgentTraceStoreError'

  constructor(
    readonly code: AgentTraceStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

interface TraceIdentity {
  readonly runId: string
  readonly nodeExecutionId: string
  readonly attemptId: string
}

export interface AgentTraceStore {
  start(header: AgentTraceHeader): Promise<void>
  append(header: AgentTraceHeader, event: AgentExecutionEvent): Promise<void>
  read(input: TraceIdentity): Promise<AgentTrace>
}

export interface RunAgentTraceContext {
  readonly workflowId: string
  readonly executionIndex: number
  readonly header: AgentTraceHeader
}

export interface RunAgentTraceReadInput extends TraceIdentity {
  readonly workflowId: string
  readonly executionIndex: number
}

export interface RunAgentTraceStore {
  start(context: RunAgentTraceContext): Promise<void>
  append(context: RunAgentTraceContext, event: AgentExecutionEvent): Promise<void>
  read(input: RunAgentTraceReadInput): Promise<AgentTrace>
}

const nodeErrorCode = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { readonly code: unknown }).code)
    : undefined

const serialized = (value: unknown): string => {
  const line = `${JSON.stringify(value)}\n`
  if (Buffer.byteLength(line) > MAX_RECORD_BYTES) {
    throw new AgentTraceStoreError('TRACE_TOO_LARGE', 'Agent trace record is too large')
  }
  return line
}

const sameHeader = (left: AgentTraceHeader, right: AgentTraceHeader): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const matchesIdentity = (header: AgentTraceHeader, identity: TraceIdentity): boolean =>
  header.runId === identity.runId &&
  header.nodeExecutionId === identity.nodeExecutionId &&
  header.attemptId === identity.attemptId

interface ParsedTrace {
  readonly trace: AgentTrace
  readonly completeBytes: number
  readonly fileBytes: number
}

const parse = async (path: string, expected?: TraceIdentity): Promise<ParsedTrace> => {
  let source: Buffer
  try {
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new AgentTraceStoreError('TRACE_UNAVAILABLE', 'Agent trace is unavailable')
    }
    if (metadata.size > MAX_TRACE_BYTES) {
      throw new AgentTraceStoreError('TRACE_TOO_LARGE', 'Agent trace is too large')
    }
    source = await readFile(path)
    if (source.byteLength > MAX_TRACE_BYTES) {
      throw new AgentTraceStoreError('TRACE_TOO_LARGE', 'Agent trace is too large')
    }
  } catch (cause) {
    if (cause instanceof AgentTraceStoreError) throw cause
    if (nodeErrorCode(cause) === 'ENOENT') {
      throw new AgentTraceStoreError('TRACE_NOT_FOUND', 'Agent trace was not found', { cause })
    }
    throw new AgentTraceStoreError('TRACE_UNAVAILABLE', 'Agent trace is unavailable', { cause })
  }
  const finalNewline = source.lastIndexOf(0x0a)
  const completeBytes = finalNewline < 0 ? 0 : finalNewline + 1
  const lines = source.subarray(0, completeBytes).toString('utf8').split('\n').slice(0, -1)
  const records: z.infer<typeof recordSchema>[] = []
  for (const line of lines) {
    if (Buffer.byteLength(line) + 1 > MAX_RECORD_BYTES) {
      throw new AgentTraceStoreError('TRACE_TOO_LARGE', 'Agent trace record is too large')
    }
    try {
      records.push(recordSchema.parse(JSON.parse(line)))
    } catch (cause) {
      throw new AgentTraceStoreError('TRACE_CORRUPT', 'Agent trace is corrupt', { cause })
    }
  }
  const first = records[0]
  if (first?.kind !== 'header' || records.slice(1).some(({ kind }) => kind === 'header')) {
    throw new AgentTraceStoreError('TRACE_CORRUPT', 'Agent trace header is invalid')
  }
  if (expected !== undefined && !matchesIdentity(first.header, expected)) {
    throw new AgentTraceStoreError('TRACE_NOT_FOUND', 'Agent trace was not found')
  }
  const events = records.flatMap((record) => (record.kind === 'event' ? [record.event] : []))
  const trace = AgentTraceSchema.parse({
    header: first.header,
    events,
    complete: terminalTypes.has(events.at(-1)?.type ?? ''),
  })
  return { trace, completeBytes, fileBytes: source.byteLength }
}

const queues = new Map<string, Promise<void>>()

const enqueue = <Value>(path: string, operation: () => Promise<Value>): Promise<Value> => {
  const previous = queues.get(path) ?? Promise.resolve()
  const result = previous.then(operation)
  const settled = result.then(
    () => undefined,
    () => undefined,
  )
  queues.set(path, settled)
  void settled.then(() => {
    if (queues.get(path) === settled) queues.delete(path)
  })
  return result
}

const start = (path: string, unparsedHeader: AgentTraceHeader): Promise<void> =>
  enqueue(path, async () => {
    const header = AgentTraceHeaderSchema.parse(unparsedHeader)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    let file
    try {
      file = await open(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      )
      await file.writeFile(serialized({ kind: 'header', header }))
      await file.sync()
    } catch (cause) {
      if (cause instanceof AgentTraceStoreError) throw cause
      if (nodeErrorCode(cause) !== 'EEXIST') {
        throw new AgentTraceStoreError('TRACE_UNAVAILABLE', 'Agent trace could not be created', {
          cause,
        })
      }
      const existing = await parse(path)
      if (!sameHeader(existing.trace.header, header)) {
        throw new AgentTraceStoreError('TRACE_ALREADY_EXISTS', 'Agent trace already exists', {
          cause,
        })
      }
    } finally {
      await file?.close()
    }
  })

const append = (
  path: string,
  unparsedHeader: AgentTraceHeader,
  unparsedEvent: AgentExecutionEvent,
): Promise<void> =>
  enqueue(path, async () => {
    const header = AgentTraceHeaderSchema.parse(unparsedHeader)
    const event = AgentExecutionEventSchema.parse(unparsedEvent)
    if (
      event.runId !== header.runId ||
      event.executionId !== header.nodeExecutionId ||
      event.nodeId !== header.nodeId
    ) {
      throw new AgentTraceStoreError(
        'TRACE_REQUEST_INVALID',
        'Agent event does not belong to the captured trace context',
      )
    }
    const existing = await parse(path, header)
    const traceEvent = AgentTraceEventSchema.parse({
      sequence: existing.trace.events.length + 1,
      timestamp: event.timestamp,
      type: event.type,
      data: event.data,
    })
    const line = serialized({ kind: 'event', event: traceEvent })
    if (existing.completeBytes + Buffer.byteLength(line) > MAX_TRACE_BYTES) {
      throw new AgentTraceStoreError('TRACE_TOO_LARGE', 'Agent trace is too large')
    }
    let file
    try {
      file = await open(path, constants.O_RDWR | constants.O_NOFOLLOW)
      if (existing.completeBytes !== existing.fileBytes) {
        await file.truncate(existing.completeBytes)
      }
      await file.write(line, existing.completeBytes, 'utf8')
      await file.sync()
    } catch (cause) {
      if (cause instanceof AgentTraceStoreError) throw cause
      throw new AgentTraceStoreError('TRACE_UNAVAILABLE', 'Agent trace could not be written', {
        cause,
      })
    } finally {
      await file?.close()
    }
  })

export const createRunFilesystemAgentTraceStore = (options: {
  readonly paths: Pick<SlopifyPaths, 'run'>
}): RunAgentTraceStore => {
  const tracePath = (input: RunAgentTraceReadInput) => {
    try {
      return resolveNodeExecutionPaths(
        options.paths.run(input.workflowId, input.runId),
        input.executionIndex,
        input.nodeExecutionId,
      ).traceFile
    } catch (cause) {
      if (cause instanceof TypeError) {
        throw new AgentTraceStoreError('TRACE_REQUEST_INVALID', 'Trace identifier is invalid', {
          cause,
        })
      }
      throw cause
    }
  }
  return {
    start(context) {
      return start(tracePath({ ...context, ...context.header }), context.header)
    },
    append(context, event) {
      return append(tracePath({ ...context, ...context.header }), context.header, event)
    },
    async read(input) {
      return (await parse(tracePath(input), input)).trace
    },
  }
}
