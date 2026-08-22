import {
  decodeExecutionMessagePayload,
  type ExecutionMessage,
  type ExecutionMessageDestination,
  type ExecutionMessageQueue,
  type NewExecutionMessage,
} from '../orchestration/execution-messages.js'
import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'
import { parseJson, serializeJson } from './json.js'
import type { Database } from './sqlite.js'

interface ExecutionMessageRow {
  readonly id: string
  readonly destination: ExecutionMessageDestination
  readonly type: ExecutionMessage['type']
  readonly run_id: string
  readonly node_execution_id: string
  readonly attempt_id: string
  readonly payload_json: string
  readonly status: ExecutionMessage['status']
  readonly available_at: string
  readonly claimed_by: string | null
  readonly lease_expires_at: string | null
  readonly attempts: number
  readonly created_at: string
  readonly processed_at: string | null
}

const mapMessage = (row: ExecutionMessageRow): ExecutionMessage => {
  const payload = parseJson(row.payload_json)
  decodeExecutionMessagePayload({ type: row.type, payload })
  return {
    id: row.id,
    destination: row.destination,
    type: row.type,
    runId: row.run_id,
    nodeExecutionId: row.node_execution_id,
    attemptId: row.attempt_id,
    payload,
    status: row.status,
    availableAt: row.available_at,
    ...(row.claimed_by === null ? {} : { claimedBy: row.claimed_by }),
    ...(row.lease_expires_at === null ? {} : { leaseExpiresAt: row.lease_expires_at }),
    attempts: row.attempts,
    createdAt: row.created_at,
    ...(row.processed_at === null ? {} : { processedAt: row.processed_at }),
  }
}

const selection = `
  SELECT id, destination, type, run_id, node_execution_id, attempt_id,
         payload_json, status, available_at, claimed_by, lease_expires_at,
         attempts, created_at, processed_at
  FROM execution_messages`

const requireDate = (value: string): string => {
  if (!Number.isFinite(Date.parse(value))) throw new TypeError('Timestamp is invalid')
  return value
}

const leaseExpiration = (now: string, durationMs: number): string => {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
    throw new TypeError('Lease duration is invalid')
  return new Date(Date.parse(requireDate(now)) + durationMs).toISOString()
}

const insertMessage = (database: Database, message: NewExecutionMessage): void => {
  decodeExecutionMessagePayload({ type: message.type, payload: message.payload })
  const expectedDestination = message.type === 'EXECUTE_JOB' ? 'WORKER' : 'COORDINATOR'
  if (message.destination !== expectedDestination)
    throw new TypeError('Message destination is invalid')
  database
    .prepare(
      `INSERT INTO execution_messages (
         id, destination, type, run_id, node_execution_id, attempt_id,
         payload_json, status, available_at, attempts, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 0, ?)`,
    )
    .run(
      message.id,
      message.destination,
      message.type,
      message.runId,
      message.nodeExecutionId,
      message.attemptId,
      serializeJson(message.payload, 'executionMessagePayload'),
      requireDate(message.availableAt),
      requireDate(message.createdAt),
    )
}

export const createSqliteExecutionMessageQueue = (
  database: WorkbenchDatabase,
): ExecutionMessageQueue => {
  const connection = getDatabaseHandle(database)
  const get = (messageId: string): ExecutionMessage | undefined => {
    const row = connection.prepare(`${selection} WHERE id = ?`).get(messageId) as
      ExecutionMessageRow | undefined
    return row === undefined ? undefined : mapMessage(row)
  }

  return {
    enqueue(message) {
      connection.transaction(() => insertMessage(connection, message)).immediate()
      const created = get(message.id)
      if (created === undefined) throw new Error('Execution message could not be read')
      return created
    },
    claimNext(input) {
      const leaseExpiresAt = leaseExpiration(input.now, input.leaseDurationMs)
      const claimedId = connection
        .transaction(() => {
          const candidate = connection
            .prepare(
              `SELECT id
               FROM execution_messages
               WHERE destination = ? AND status = 'PENDING' AND available_at <= ?
               ORDER BY available_at, created_at, rowid
               LIMIT 1`,
            )
            .pluck()
            .get(input.destination, requireDate(input.now))
          if (typeof candidate !== 'string') return undefined
          const result = connection
            .prepare(
              `UPDATE execution_messages
               SET status = 'CLAIMED', claimed_by = ?, lease_expires_at = ?,
                   attempts = attempts + 1
               WHERE id = ? AND status = 'PENDING'`,
            )
            .run(input.consumerId, leaseExpiresAt, candidate)
          return result.changes === 1 ? candidate : undefined
        })
        .immediate()
      return claimedId === undefined ? undefined : get(claimedId)
    },
    renewClaim(input) {
      const result = connection
        .prepare(
          `UPDATE execution_messages
           SET lease_expires_at = ?
           WHERE id = ? AND status = 'CLAIMED' AND claimed_by = ?`,
        )
        .run(leaseExpiration(input.now, input.leaseDurationMs), input.messageId, input.consumerId)
      return result.changes === 1
    },
    recoverExpired(input) {
      if (!input.retry) return []
      return connection
        .transaction(() => {
          const ids = connection
            .prepare(
              `SELECT id
               FROM execution_messages
               WHERE destination = ? AND status = 'CLAIMED'
                 AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
               ORDER BY id`,
            )
            .pluck()
            .all(input.destination, requireDate(input.now)) as string[]
          if (ids.length === 0) return ids
          const update = connection.prepare(
            `UPDATE execution_messages
             SET status = 'PENDING', claimed_by = NULL, lease_expires_at = NULL
             WHERE id = ? AND status = 'CLAIMED'`,
          )
          for (const id of ids) update.run(id)
          return ids
        })
        .immediate()
    },
    cancelPendingRunCommands(input) {
      return connection
        .transaction(() => {
          const ids = connection
            .prepare(
              `SELECT id FROM execution_messages
               WHERE destination = 'WORKER' AND run_id = ? AND status = 'PENDING'
               ORDER BY id`,
            )
            .pluck()
            .all(input.runId) as string[]
          if (ids.length === 0) return ids
          connection
            .prepare(
              `UPDATE execution_messages
               SET status = 'PROCESSED', processed_at = ?
               WHERE destination = 'WORKER' AND run_id = ? AND status = 'PENDING'`,
            )
            .run(requireDate(input.processedAt), input.runId)
          return ids
        })
        .immediate()
    },
    completeClaim(input) {
      connection
        .transaction(() => {
          const result = connection
            .prepare(
              `UPDATE execution_messages
               SET status = 'PROCESSED', processed_at = ?, lease_expires_at = NULL
               WHERE id = ? AND status = 'CLAIMED' AND claimed_by = ?`,
            )
            .run(requireDate(input.processedAt), input.messageId, input.consumerId)
          if (result.changes !== 1)
            throw new Error('Execution message claim is not owned by this consumer')
          for (const message of input.emitted) insertMessage(connection, message)
        })
        .immediate()
    },
    get,
    list(input = {}) {
      const filters: string[] = []
      const values: string[] = []
      if (input.destination !== undefined) {
        filters.push('destination = ?')
        values.push(input.destination)
      }
      if (input.status !== undefined) {
        filters.push('status = ?')
        values.push(input.status)
      }
      const where = filters.length === 0 ? '' : ` WHERE ${filters.join(' AND ')}`
      const rows = connection
        .prepare(`${selection}${where} ORDER BY created_at, rowid`)
        .all(...values) as ExecutionMessageRow[]
      return rows.map(mapMessage)
    },
  }
}
