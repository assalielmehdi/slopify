import { RunEventSchema, RunIdSchema, type RunEvent, type RunId } from '@loop/contracts'
import type BetterSqlite3 from 'better-sqlite3'

import type { WorkbenchDatabase } from '../persistence/database.js'
import { getDatabaseHandle } from '../persistence/database.js'
import { PersistenceError } from '../persistence/errors.js'

export type NewRunEvent = RunEvent extends infer Event
  ? Event extends RunEvent
    ? Omit<Event, 'runId' | 'sequence'>
    : never
  : never

export interface EventPage {
  readonly events: readonly RunEvent[]
  readonly nextAfterSequence: number | null
}

export interface ListEventsInput {
  readonly runId: RunId
  readonly afterSequence?: number
  readonly limit: number
}

export interface EventStore {
  list(input: ListEventsInput): EventPage
}

interface EventRow {
  readonly sequence: number
  readonly event_type: RunEvent['type']
  readonly node_id: string | null
  readonly data_json: string
  readonly created_at: string
}

export const appendEvent = (
  database: BetterSqlite3.Database,
  runIdInput: RunId,
  event: NewRunEvent,
  nodeExecutionId: string | null = null,
): RunEvent => {
  const runId = RunIdSchema.parse(runIdInput)
  const sequenceValue = database
    .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 FROM run_events WHERE run_id = ?')
    .pluck()
    .get(runId)
  if (typeof sequenceValue !== 'number') {
    throw new PersistenceError({
      code: 'PERSISTENCE_WRITE_FAILED',
      message: 'Could not allocate the next run event sequence',
    })
  }

  const persistedEvent = RunEventSchema.parse({
    ...event,
    runId,
    sequence: sequenceValue,
  })
  const nodeId = 'nodeId' in persistedEvent ? persistedEvent.nodeId : null
  database
    .prepare(
      `INSERT INTO run_events (
         run_id, sequence, event_type, node_execution_id, node_id, data_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      sequenceValue,
      persistedEvent.type,
      nodeExecutionId,
      nodeId,
      JSON.stringify(persistedEvent.data),
      persistedEvent.timestamp,
    )

  return persistedEvent
}

export const createEventStore = (database: WorkbenchDatabase): EventStore => {
  const connection = getDatabaseHandle(database)

  return {
    list(input) {
      const afterSequence = input.afterSequence ?? 0
      if (
        !Number.isSafeInteger(afterSequence) ||
        afterSequence < 0 ||
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 1_000
      ) {
        throw new PersistenceError({
          code: 'PERSISTENCE_VALIDATION_FAILED',
          message: 'Event pagination is outside the supported range',
          details: { afterSequence, limit: input.limit },
        })
      }
      const runId = RunIdSchema.parse(input.runId)

      try {
        const rows = connection
          .prepare(
            `SELECT sequence, event_type, node_id, data_json, created_at
             FROM run_events
             WHERE run_id = ? AND sequence > ?
             ORDER BY sequence
             LIMIT ?`,
          )
          .all(runId, afterSequence, input.limit + 1) as EventRow[]
        const hasMore = rows.length > input.limit
        const pageRows = hasMore ? rows.slice(0, input.limit) : rows
        const events = pageRows.map((row) =>
          RunEventSchema.parse({
            runId,
            sequence: row.sequence,
            timestamp: row.created_at,
            type: row.event_type,
            ...(row.node_id === null ? {} : { nodeId: row.node_id }),
            data: JSON.parse(row.data_json),
          }),
        )

        return {
          events,
          nextAfterSequence: hasMore ? (events.at(-1)?.sequence ?? null) : null,
        }
      } catch (cause) {
        if (cause instanceof PersistenceError) throw cause
        throw new PersistenceError({
          code: 'PERSISTENCE_READ_FAILED',
          message: 'Could not read run events',
          cause,
        })
      }
    },
  }
}
