import { z } from 'zod'

import type { ConnectionRecord, ConnectionRepository } from '../connections/connection-service.js'
import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'
import { mapPersistenceError } from './errors.js'

const ConnectionRecordSchema = z.strictObject({
  connectionId: z.string().min(1),
  type: z.enum(['gitlab', 'clickup', 'openrouter', 'chatgpt-subscription']),
  category: z.enum(['connector', 'inference']),
  label: z.string().min(1),
  authority: z.string().min(1),
  configuration: z.unknown(),
  metadata: z.unknown(),
  status: z.enum(['CONNECTED', 'INVALID']),
  validatedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

interface ConnectionRow {
  readonly connection_id: string
  readonly type: string
  readonly category: string
  readonly label: string
  readonly authority: string
  readonly configuration_json: string
  readonly metadata_json: string
  readonly status: string
  readonly validated_at: string
  readonly created_at: string
  readonly updated_at: string
}

const parseRow = (row: ConnectionRow): ConnectionRecord =>
  ConnectionRecordSchema.parse({
    connectionId: row.connection_id,
    type: row.type,
    category: row.category,
    label: row.label,
    authority: row.authority,
    configuration: JSON.parse(row.configuration_json),
    metadata: JSON.parse(row.metadata_json),
    status: row.status,
    validatedAt: row.validated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })

export const createConnectionRepository = (database: WorkbenchDatabase): ConnectionRepository => {
  const connection = getDatabaseHandle(database)
  const select = `SELECT connection_id, type, category, label, authority,
    configuration_json, metadata_json, status, validated_at, created_at, updated_at
    FROM connections`

  return {
    get(connectionId) {
      const row = connection.prepare(`${select} WHERE connection_id = ?`).get(connectionId) as
        ConnectionRow | undefined
      return row === undefined ? undefined : parseRow(row)
    },
    getByType(type) {
      const row = connection.prepare(`${select} WHERE type = ?`).get(type) as
        ConnectionRow | undefined
      return row === undefined ? undefined : parseRow(row)
    },
    list() {
      return (
        connection.prepare(`${select} ORDER BY label, connection_id`).all() as ConnectionRow[]
      ).map(parseRow)
    },
    save(input) {
      const record = ConnectionRecordSchema.parse(input)
      try {
        connection
          .prepare(
            `INSERT INTO connections (
              connection_id, type, category, label, authority, configuration_json,
              metadata_json, status, validated_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (connection_id) DO UPDATE SET
              type = excluded.type,
              category = excluded.category,
              label = excluded.label,
              authority = excluded.authority,
              configuration_json = excluded.configuration_json,
              metadata_json = excluded.metadata_json,
              status = excluded.status,
              validated_at = excluded.validated_at,
              updated_at = excluded.updated_at`,
          )
          .run(
            record.connectionId,
            record.type,
            record.category,
            record.label,
            record.authority,
            JSON.stringify(record.configuration),
            JSON.stringify(record.metadata),
            record.status,
            record.validatedAt,
            record.createdAt,
            record.updatedAt,
          )
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not persist connection metadata')
      }
    },
    delete(connectionId) {
      connection.prepare('DELETE FROM connections WHERE connection_id = ?').run(connectionId)
    },
  }
}
