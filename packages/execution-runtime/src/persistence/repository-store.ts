import { DeletionReceiptSchema, GitProviderSchema, RepositoryIdSchema } from '@slopify/contracts'

import type { RepositoryRecord, RepositoryStore } from '../repositories/repository-store.js'
import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'
import { mapPersistenceError, PersistenceError } from './errors.js'

interface RepositoryRow {
  readonly repository_id: string
  readonly name: string
  readonly provider: string
  readonly remote_id: string
  readonly repository_full_name: string
  readonly clone_url: string
  readonly web_url: string
  readonly default_branch: string
  readonly created_at: string
  readonly updated_at: string
}

const selection = `repository_id, name, provider, remote_id, repository_full_name,
  clone_url, web_url, default_branch, created_at, updated_at`

const parseRow = (row: RepositoryRow): RepositoryRecord => ({
  repositoryId: RepositoryIdSchema.parse(row.repository_id),
  name: row.name,
  provider: GitProviderSchema.parse(row.provider),
  remoteId: row.remote_id,
  fullName: row.repository_full_name,
  cloneUrl: row.clone_url,
  webUrl: row.web_url,
  defaultBranch: row.default_branch,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const isConstraintError = (cause: unknown): boolean =>
  typeof cause === 'object' &&
  cause !== null &&
  'code' in cause &&
  typeof cause.code === 'string' &&
  cause.code.startsWith('SQLITE_CONSTRAINT')

export const createRepositoryStore = (database: WorkbenchDatabase): RepositoryStore => {
  const connection = getDatabaseHandle(database)
  return {
    async add(repository) {
      try {
        connection
          .prepare(
            `INSERT INTO repositories (
               repository_id, name, provider, remote_id, repository_full_name,
               clone_url, web_url, default_branch, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            RepositoryIdSchema.parse(repository.repositoryId),
            repository.name,
            GitProviderSchema.parse(repository.provider),
            repository.remoteId,
            repository.fullName,
            repository.cloneUrl,
            repository.webUrl,
            repository.defaultBranch,
            repository.createdAt,
            repository.updatedAt,
          )
      } catch (cause) {
        if (isConstraintError(cause)) {
          throw new PersistenceError({
            code: 'PERSISTENCE_CONFLICT',
            message: 'Repository already exists',
            cause,
          })
        }
        throw mapPersistenceError(cause, 'Could not persist repository')
      }
    },
    async get(repositoryId) {
      const row = connection
        .prepare(
          `SELECT ${selection} FROM repositories WHERE repository_id = ? AND deletion_id IS NULL`,
        )
        .get(RepositoryIdSchema.parse(repositoryId)) as RepositoryRow | undefined
      return row === undefined ? undefined : parseRow(row)
    },
    async findByRemote(provider, remoteId) {
      const row = connection
        .prepare(
          `SELECT ${selection} FROM repositories
           WHERE provider = ? AND remote_id = ? AND deletion_id IS NULL`,
        )
        .get(GitProviderSchema.parse(provider), remoteId) as RepositoryRow | undefined
      return row === undefined ? undefined : parseRow(row)
    },
    async list() {
      return (
        connection
          .prepare(
            `SELECT ${selection} FROM repositories
             WHERE deletion_id IS NULL ORDER BY created_at, repository_id`,
          )
          .all() as RepositoryRow[]
      ).map(parseRow)
    },
    async delete(repositoryId) {
      try {
        return (
          connection
            .prepare('DELETE FROM repositories WHERE repository_id = ?')
            .run(RepositoryIdSchema.parse(repositoryId)).changes > 0
        )
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not delete repository')
      }
    },
    async stageDeletion(input) {
      const receipt = DeletionReceiptSchema.parse(input)
      if (receipt.subject.type !== 'REPOSITORY') return false
      const stage = connection.transaction(() => {
        connection
          .prepare(
            `INSERT INTO deletion_operations (
              deletion_id, subject_type, subject_id, state, deleted_at, undo_expires_at
            ) VALUES (?, 'REPOSITORY', ?, 'PENDING', ?, ?)`,
          )
          .run(receipt.deletionId, receipt.subject.id, receipt.deletedAt, receipt.undoExpiresAt)
        const updated = connection
          .prepare(
            `UPDATE repositories SET deletion_id = ?, deleted_at = ?
             WHERE repository_id = ? AND deletion_id IS NULL`,
          )
          .run(receipt.deletionId, receipt.deletedAt, receipt.subject.id)
        if (updated.changes === 0) throw new Error('REPOSITORY_NOT_FOUND')
        return true
      })
      try {
        return stage.immediate() as boolean
      } catch (cause) {
        if (cause instanceof Error && cause.message === 'REPOSITORY_NOT_FOUND') return false
        throw mapPersistenceError(cause, 'Could not stage repository deletion')
      }
    },
    async restoreDeletion(deletionId, now) {
      const restore = connection.transaction(() => {
        const operation = connection
          .prepare(
            `SELECT state, undo_expires_at FROM deletion_operations
             WHERE deletion_id = ? AND subject_type = 'REPOSITORY'`,
          )
          .get(deletionId) as
          Readonly<{ state: 'PENDING' | 'UNDONE' | 'PURGED'; undo_expires_at: string }> | undefined
        if (operation === undefined) return 'NOT_FOUND' as const
        if (operation.state === 'UNDONE') return 'UNDONE' as const
        if (operation.state === 'PURGED') return 'EXPIRED' as const
        if (Date.parse(operation.undo_expires_at) <= Date.parse(now)) {
          connection.prepare('DELETE FROM repositories WHERE deletion_id = ?').run(deletionId)
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
            'UPDATE repositories SET deletion_id = NULL, deleted_at = NULL WHERE deletion_id = ?',
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
        throw mapPersistenceError(cause, 'Could not restore repository deletion')
      }
    },
    async purgeExpired(now) {
      const purge = connection.transaction(() => {
        connection
          .prepare(
            `DELETE FROM repositories WHERE deletion_id IN (
               SELECT deletion_id FROM deletion_operations
               WHERE subject_type = 'REPOSITORY' AND state = 'PENDING'
                 AND julianday(undo_expires_at) <= julianday(?)
             )`,
          )
          .run(now)
        connection
          .prepare(
            `UPDATE deletion_operations SET state = 'PURGED', purged_at = ?
             WHERE subject_type = 'REPOSITORY' AND state = 'PENDING'
               AND julianday(undo_expires_at) <= julianday(?)`,
          )
          .run(now, now)
      })
      try {
        purge.immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not purge repository deletions')
      }
    },
  }
}
