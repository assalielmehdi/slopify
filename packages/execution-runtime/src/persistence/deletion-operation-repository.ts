import { DeletionReceiptSchema, type DeletionReceipt } from '@slopify/contracts'

import type {
  DeletionOperation,
  DeletionOperationRepository,
} from '../deletions/deletion-service.js'
import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'

interface DeletionOperationRow {
  readonly deletion_id: string
  readonly subject_type: DeletionReceipt['subject']['type']
  readonly subject_id: string
  readonly state: DeletionOperation['state']
  readonly deleted_at: string
  readonly undo_expires_at: string
}

const parseRow = (row: DeletionOperationRow): DeletionOperation => ({
  ...DeletionReceiptSchema.parse({
    deletionId: row.deletion_id,
    subject: { type: row.subject_type, id: row.subject_id },
    deletedAt: row.deleted_at,
    undoExpiresAt: row.undo_expires_at,
  }),
  state: row.state,
})

export const createDeletionOperationRepository = (
  database: WorkbenchDatabase,
): DeletionOperationRepository => {
  const connection = getDatabaseHandle(database)
  return {
    get(deletionId) {
      const row = connection
        .prepare(
          `SELECT deletion_id, subject_type, subject_id, state, deleted_at, undo_expires_at
           FROM deletion_operations
           WHERE deletion_id = ?`,
        )
        .get(deletionId) as DeletionOperationRow | undefined
      return row === undefined ? undefined : parseRow(row)
    },
  }
}
