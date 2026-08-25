import { GitConnectionSchema, GitProviderSchema } from '@slopify/contracts'

import type {
  GitConnectionRecord,
  GitConnectionRepository,
} from '../git/git-connection-repository.js'
import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'
import { mapPersistenceError } from './errors.js'

interface GitConnectionRow {
  readonly provider: string
  readonly account_username: string
  readonly connected_at: string
  readonly updated_at: string
}

const parseRow = (row: GitConnectionRow): GitConnectionRecord =>
  GitConnectionSchema.parse({
    provider: row.provider,
    accountUsername: row.account_username,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  })

export const createGitConnectionRepository = (
  database: WorkbenchDatabase,
): GitConnectionRepository => {
  const connection = getDatabaseHandle(database)
  return {
    async get(providerInput) {
      const row = connection
        .prepare(
          `SELECT provider, account_username, connected_at, updated_at
           FROM git_connections WHERE provider = ?`,
        )
        .get(GitProviderSchema.parse(providerInput)) as GitConnectionRow | undefined
      return row === undefined ? undefined : parseRow(row)
    },
    async list() {
      return (
        connection
          .prepare(
            `SELECT provider, account_username, connected_at, updated_at
             FROM git_connections ORDER BY provider`,
          )
          .all() as GitConnectionRow[]
      ).map(parseRow)
    },
    async save(input) {
      const record = GitConnectionSchema.parse(input)
      try {
        connection
          .prepare(
            `INSERT INTO git_connections (
               provider, account_username, connected_at, updated_at
             ) VALUES (?, ?, ?, ?)
             ON CONFLICT (provider) DO UPDATE SET
               account_username = excluded.account_username,
               updated_at = excluded.updated_at`,
          )
          .run(record.provider, record.accountUsername, record.connectedAt, record.updatedAt)
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not persist Git connection')
      }
    },
    async delete(providerInput) {
      try {
        return (
          connection
            .prepare('DELETE FROM git_connections WHERE provider = ?')
            .run(GitProviderSchema.parse(providerInput)).changes > 0
        )
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not delete Git connection')
      }
    },
  }
}
