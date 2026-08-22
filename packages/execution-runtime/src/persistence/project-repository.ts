import { DeletionReceiptSchema, ProjectIdSchema } from '@slopify/contracts'

import type { ProjectRecord, ProjectRepository } from '../projects/project-repository.js'
import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'
import { mapPersistenceError, PersistenceError } from './errors.js'

interface ProjectRow {
  readonly project_id: string
  readonly name: string
  readonly repository_path: string
  readonly created_at: string
  readonly updated_at: string
}

const parseRow = (row: ProjectRow): ProjectRecord => ({
  projectId: ProjectIdSchema.parse(row.project_id),
  name: row.name,
  repositoryPath: row.repository_path,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const isConstraintError = (cause: unknown): boolean =>
  typeof cause === 'object' &&
  cause !== null &&
  'code' in cause &&
  typeof cause.code === 'string' &&
  cause.code.startsWith('SQLITE_CONSTRAINT')

export const createProjectRepository = (database: WorkbenchDatabase): ProjectRepository => {
  const connection = getDatabaseHandle(database)
  const find = (column: 'project_id' | 'repository_path', value: string) => {
    const row = connection
      .prepare(
        `SELECT project_id, name, repository_path, created_at, updated_at
         FROM projects
         WHERE ${column} = ? AND deletion_id IS NULL`,
      )
      .get(value) as ProjectRow | undefined
    return row === undefined ? undefined : parseRow(row)
  }

  return {
    add(project) {
      try {
        connection
          .prepare(
            `INSERT INTO projects (project_id, name, repository_path, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            ProjectIdSchema.parse(project.projectId),
            project.name,
            project.repositoryPath,
            project.createdAt,
            project.updatedAt,
          )
      } catch (cause) {
        if (isConstraintError(cause)) {
          throw new PersistenceError({
            code: 'PERSISTENCE_CONFLICT',
            message: 'Project already exists',
            cause,
          })
        }
        throw mapPersistenceError(cause, 'Could not persist project')
      }
    },
    get(projectId) {
      return find('project_id', ProjectIdSchema.parse(projectId))
    },
    findByPath(repositoryPath) {
      return find('repository_path', repositoryPath)
    },
    list() {
      return (
        connection
          .prepare(
            `SELECT project_id, name, repository_path, created_at, updated_at
             FROM projects
             WHERE deletion_id IS NULL
             ORDER BY created_at, project_id`,
          )
          .all() as ProjectRow[]
      ).map(parseRow)
    },
    stageDeletion(input) {
      const receipt = DeletionReceiptSchema.parse(input)
      if (receipt.subject.type !== 'PROJECT') return false
      const stage = connection.transaction(() => {
        const inserted = connection
          .prepare(
            `INSERT INTO deletion_operations (
              deletion_id, subject_type, subject_id, state, deleted_at, undo_expires_at
            ) VALUES (?, 'PROJECT', ?, 'PENDING', ?, ?)`,
          )
          .run(receipt.deletionId, receipt.subject.id, receipt.deletedAt, receipt.undoExpiresAt)
        const updated = connection
          .prepare(
            `UPDATE projects
             SET deletion_id = ?, deleted_at = ?
             WHERE project_id = ? AND deletion_id IS NULL`,
          )
          .run(receipt.deletionId, receipt.deletedAt, receipt.subject.id)
        if (updated.changes === 0) throw new Error('PROJECT_NOT_FOUND')
        return inserted.changes > 0
      })
      try {
        return stage.immediate() as boolean
      } catch (cause) {
        if (cause instanceof Error && cause.message === 'PROJECT_NOT_FOUND') return false
        throw mapPersistenceError(cause, 'Could not stage project deletion')
      }
    },
    restoreDeletion(deletionId, now) {
      const restore = connection.transaction(() => {
        const operation = connection
          .prepare(
            `SELECT state, undo_expires_at
             FROM deletion_operations
             WHERE deletion_id = ? AND subject_type = 'PROJECT'`,
          )
          .get(deletionId) as
          Readonly<{ state: 'PENDING' | 'UNDONE' | 'PURGED'; undo_expires_at: string }> | undefined
        if (operation === undefined) return 'NOT_FOUND' as const
        if (operation.state === 'UNDONE') return 'UNDONE' as const
        if (operation.state === 'PURGED') return 'EXPIRED' as const
        if (Date.parse(operation.undo_expires_at) <= Date.parse(now)) {
          connection.prepare('DELETE FROM projects WHERE deletion_id = ?').run(deletionId)
          connection
            .prepare(
              `UPDATE deletion_operations
               SET state = 'PURGED', purged_at = ?
               WHERE deletion_id = ? AND state = 'PENDING'`,
            )
            .run(now, deletionId)
          return 'EXPIRED' as const
        }
        connection
          .prepare(
            `UPDATE projects
             SET deletion_id = NULL, deleted_at = NULL
             WHERE deletion_id = ?`,
          )
          .run(deletionId)
        connection
          .prepare(
            `UPDATE deletion_operations
             SET state = 'UNDONE', restored_at = ?
             WHERE deletion_id = ? AND state = 'PENDING'`,
          )
          .run(now, deletionId)
        return 'UNDONE' as const
      })
      try {
        return restore.immediate() as 'UNDONE' | 'EXPIRED' | 'NOT_FOUND'
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not restore project deletion')
      }
    },
    purgeExpired(now) {
      const purge = connection.transaction(() => {
        connection
          .prepare(
            `DELETE FROM projects
             WHERE deletion_id IN (
               SELECT deletion_id
               FROM deletion_operations
               WHERE subject_type = 'PROJECT'
                 AND state = 'PENDING'
                 AND julianday(undo_expires_at) <= julianday(?)
             )`,
          )
          .run(now)
        connection
          .prepare(
            `UPDATE deletion_operations
             SET state = 'PURGED', purged_at = ?
             WHERE subject_type = 'PROJECT'
               AND state = 'PENDING'
               AND julianday(undo_expires_at) <= julianday(?)`,
          )
          .run(now, now)
      })
      try {
        purge.immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not purge project deletions')
      }
    },
  }
}
