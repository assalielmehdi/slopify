import { DeletionReceiptSchema, WorkflowIdSchema, type DeletionReceipt } from '@slopify/contracts'
import { WorkflowSchema, type Workflow } from '@slopify/workflow-model'

import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'
import { mapPersistenceError, PersistenceError } from './errors.js'

export interface WorkflowRepository {
  insert(workflow: Workflow): void
  save(workflow: Workflow): void
  get(workflowId: string): Workflow | undefined
  list(): readonly Workflow[]
  stageDeletion(receipt: DeletionReceipt): boolean
  restoreDeletion(deletionId: string, now: string): 'UNDONE' | 'EXPIRED' | 'NOT_FOUND'
  purgeExpired(now: string): void
}

interface WorkflowRow {
  readonly definition_json: string
}

const isConstraintError = (cause: unknown): boolean =>
  typeof cause === 'object' &&
  cause !== null &&
  'code' in cause &&
  typeof cause.code === 'string' &&
  cause.code.startsWith('SQLITE_CONSTRAINT')

export const createWorkflowRepository = (database: WorkbenchDatabase): WorkflowRepository => {
  const connection = getDatabaseHandle(database)

  const get = (workflowIdInput: string): Workflow | undefined => {
    const workflowId = WorkflowIdSchema.parse(workflowIdInput)
    const row = connection
      .prepare(
        `SELECT definition_json
         FROM workflows
         WHERE workflow_id = ? AND deletion_id IS NULL`,
      )
      .get(workflowId) as WorkflowRow | undefined
    return row === undefined ? undefined : WorkflowSchema.parse(JSON.parse(row.definition_json))
  }

  return {
    insert(workflowInput) {
      const workflow = WorkflowSchema.parse(workflowInput)
      try {
        connection
          .prepare(
            `INSERT INTO workflows (workflow_id, definition_json)
             VALUES (?, ?)`,
          )
          .run(workflow.workflowId, JSON.stringify(workflow))
      } catch (cause) {
        if (isConstraintError(cause)) {
          throw new PersistenceError({
            code: 'PERSISTENCE_CONFLICT',
            message: 'Workflow already exists',
            cause,
          })
        }
        throw mapPersistenceError(cause, 'Could not persist workflow')
      }
    },
    save(workflowInput) {
      const workflow = WorkflowSchema.parse(workflowInput)
      try {
        connection
          .prepare(
            `INSERT INTO workflows (workflow_id, definition_json)
             VALUES (?, ?)
             ON CONFLICT (workflow_id) DO UPDATE SET
               definition_json = excluded.definition_json`,
          )
          .run(workflow.workflowId, JSON.stringify(workflow))
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not persist workflow')
      }
    },
    get,
    list() {
      const rows = connection
        .prepare(
          `SELECT definition_json
           FROM workflows
           WHERE deletion_id IS NULL
           ORDER BY json_extract(definition_json, '$.updatedAt') DESC, workflow_id`,
        )
        .all() as WorkflowRow[]
      return rows.map((row) => WorkflowSchema.parse(JSON.parse(row.definition_json)))
    },
    stageDeletion(input) {
      const receipt = DeletionReceiptSchema.parse(input)
      if (receipt.subject.type !== 'WORKFLOW') return false
      const stage = connection.transaction(() => {
        connection
          .prepare(
            `INSERT INTO deletion_operations (
              deletion_id, subject_type, subject_id, state, deleted_at, undo_expires_at
            ) VALUES (?, 'WORKFLOW', ?, 'PENDING', ?, ?)`,
          )
          .run(receipt.deletionId, receipt.subject.id, receipt.deletedAt, receipt.undoExpiresAt)
        const updated = connection
          .prepare(
            `UPDATE workflows SET deletion_id = ?, deleted_at = ?
             WHERE workflow_id = ? AND deletion_id IS NULL`,
          )
          .run(receipt.deletionId, receipt.deletedAt, receipt.subject.id)
        if (updated.changes === 0) throw new Error('WORKFLOW_NOT_FOUND')
        return true
      })
      try {
        return stage.immediate() as boolean
      } catch (cause) {
        if (cause instanceof Error && cause.message === 'WORKFLOW_NOT_FOUND') return false
        throw mapPersistenceError(cause, 'Could not stage workflow deletion')
      }
    },
    restoreDeletion(deletionId, now) {
      const restore = connection.transaction(() => {
        const operation = connection
          .prepare(
            `SELECT state, undo_expires_at FROM deletion_operations
             WHERE deletion_id = ? AND subject_type = 'WORKFLOW'`,
          )
          .get(deletionId) as
          Readonly<{ state: 'PENDING' | 'UNDONE' | 'PURGED'; undo_expires_at: string }> | undefined
        if (operation === undefined) return 'NOT_FOUND' as const
        if (operation.state === 'UNDONE') return 'UNDONE' as const
        if (operation.state === 'PURGED') return 'EXPIRED' as const
        if (Date.parse(operation.undo_expires_at) <= Date.parse(now)) {
          connection
            .prepare(
              `UPDATE deletion_operations SET state = 'PURGED', purged_at = ?
               WHERE deletion_id = ? AND state = 'PENDING'`,
            )
            .run(now, deletionId)
          return 'EXPIRED' as const
        }
        connection
          .prepare(
            'UPDATE workflows SET deletion_id = NULL, deleted_at = NULL WHERE deletion_id = ?',
          )
          .run(deletionId)
        connection
          .prepare(
            `UPDATE deletion_operations SET state = 'UNDONE', restored_at = ?
             WHERE deletion_id = ? AND state = 'PENDING'`,
          )
          .run(now, deletionId)
        return 'UNDONE' as const
      })
      try {
        return restore.immediate() as 'UNDONE' | 'EXPIRED' | 'NOT_FOUND'
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not restore workflow deletion')
      }
    },
    purgeExpired(now) {
      try {
        connection
          .prepare(
            `UPDATE deletion_operations SET state = 'PURGED', purged_at = ?
             WHERE subject_type = 'WORKFLOW' AND state = 'PENDING'
               AND julianday(undo_expires_at) <= julianday(?)`,
          )
          .run(now, now)
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not purge workflow deletions')
      }
    },
  }
}
