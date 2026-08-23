import { constants } from 'node:fs'
import { appendFile, mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  type AgentExecutionEvent,
  AgentTraceEventSchema,
  AgentTraceHeaderSchema,
  AgentTraceSchema,
  type AgentTrace,
  type AgentTraceHeader,
} from '@slopify/contracts'
import { z } from 'zod'

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u)
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
  'TRACE_ALREADY_EXISTS' | 'TRACE_NOT_FOUND' | 'TRACE_REQUEST_INVALID' | 'TRACE_CORRUPT'

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

export interface AgentTraceStore {
  start(header: AgentTraceHeader): Promise<void>
  append(header: AgentTraceHeader, event: AgentExecutionEvent): Promise<void>
  read(input: {
    readonly runId: string
    readonly nodeExecutionId: string
    readonly attemptId: string
  }): Promise<AgentTrace>
}

const validId = (value: string): string => {
  const result = identifier.safeParse(value)
  if (!result.success)
    throw new AgentTraceStoreError('TRACE_REQUEST_INVALID', 'Trace identifier is invalid')
  return result.data
}

const serialized = (value: unknown): string => `${JSON.stringify(value)}\n`

export const createFilesystemAgentTraceStore = (options: {
  readonly root: string
}): AgentTraceStore => {
  const sequenceByPath = new Map<string, number>()
  const tracePath = (input: {
    readonly runId: string
    readonly nodeExecutionId: string
    readonly attemptId: string
  }) =>
    join(
      options.root,
      'runs',
      validId(input.runId),
      'executions',
      validId(input.nodeExecutionId),
      `${validId(input.attemptId)}.jsonl`,
    )

  const parse = async (path: string): Promise<AgentTrace> => {
    let source: string
    try {
      source = await readFile(path, 'utf8')
    } catch (cause) {
      throw new AgentTraceStoreError('TRACE_NOT_FOUND', 'Agent trace was not found', { cause })
    }
    const lines = source.split('\n')
    if (lines.at(-1) === '') lines.pop()
    const records: z.infer<typeof recordSchema>[] = []
    for (const [index, line] of lines.entries()) {
      if (line.trim() === '') continue
      try {
        records.push(recordSchema.parse(JSON.parse(line)))
      } catch (cause) {
        if (index === lines.length - 1) break
        throw new AgentTraceStoreError('TRACE_CORRUPT', 'Agent trace is corrupt', { cause })
      }
    }
    const first = records[0]
    if (first?.kind !== 'header')
      throw new AgentTraceStoreError('TRACE_CORRUPT', 'Agent trace header is missing')
    const events = records.flatMap((record) => (record.kind === 'event' ? [record.event] : []))
    return AgentTraceSchema.parse({
      header: first.header,
      events,
      complete: terminalTypes.has(events.at(-1)?.type ?? ''),
    })
  }

  return {
    async start(unparsedHeader) {
      const header = AgentTraceHeaderSchema.parse(unparsedHeader)
      const path = tracePath(header)
      await mkdir(join(path, '..'), { recursive: true, mode: 0o700 })
      let file
      try {
        file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
        await file.writeFile(serialized({ kind: 'header', header }))
        sequenceByPath.set(path, 0)
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
        const existing = await parse(path)
        if (JSON.stringify(existing.header) !== JSON.stringify(header)) {
          throw new AgentTraceStoreError('TRACE_ALREADY_EXISTS', 'Agent trace already exists', {
            cause,
          })
        }
        sequenceByPath.set(path, existing.events.length)
      } finally {
        await file?.close()
      }
    },

    async append(unparsedHeader, event) {
      const header = AgentTraceHeaderSchema.parse(unparsedHeader)
      const path = tracePath(header)
      const current = sequenceByPath.get(path) ?? (await parse(path)).events.length
      const data = JSON.parse(JSON.stringify(event.data)) as never
      const traceEvent = AgentTraceEventSchema.parse({
        sequence: current + 1,
        timestamp: event.timestamp,
        type: event.type,
        data,
      })
      await appendFile(path, serialized({ kind: 'event', event: traceEvent }), { mode: 0o600 })
      sequenceByPath.set(path, traceEvent.sequence)
    },

    async read(input) {
      return parse(tracePath(input))
    },
  }
}
