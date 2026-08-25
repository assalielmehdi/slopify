import { RepositorySchema, type GitProvider } from '@slopify/contracts'
import { z } from 'zod'

export const RepositoryRecordSchema = RepositorySchema.omit({ availability: true })

export const RepositoryCollectionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    repositories: z.array(RepositoryRecordSchema).max(10_000).readonly(),
  })
  .superRefine((collection, context) => {
    const repositoryIds = new Set<string>()
    const remoteRepositories = new Set<string>()
    for (const [index, repository] of collection.repositories.entries()) {
      if (repositoryIds.has(repository.repositoryId)) {
        context.addIssue({
          code: 'custom',
          message: 'Repository IDs must be unique',
          path: ['repositories', index, 'repositoryId'],
        })
      }
      const remoteKey = `${repository.provider}:${repository.remoteId}`
      if (remoteRepositories.has(remoteKey)) {
        context.addIssue({
          code: 'custom',
          message: 'Provider repositories must be unique',
          path: ['repositories', index, 'remoteId'],
        })
      }
      repositoryIds.add(repository.repositoryId)
      remoteRepositories.add(remoteKey)
    }
  })

export type RepositoryRecord = z.input<typeof RepositoryRecordSchema>
export type RepositoryCollection = z.output<typeof RepositoryCollectionSchema>

export type RepositoryStoreErrorCode =
  | 'REPOSITORIES_FILE_INVALID'
  | 'REPOSITORIES_REVISION_CONFLICT'
  | 'REPOSITORIES_UNAVAILABLE'
  | 'REPOSITORY_CONFLICT'

export class RepositoryStoreError extends Error {
  readonly code: RepositoryStoreErrorCode

  constructor(code: RepositoryStoreErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'RepositoryStoreError'
    this.code = code
  }
}

export interface RepositoryStore {
  add(repository: RepositoryRecord): Promise<void>
  get(repositoryId: string): Promise<RepositoryRecord | undefined>
  findByRemote(provider: GitProvider, remoteId: string): Promise<RepositoryRecord | undefined>
  list(): Promise<readonly RepositoryRecord[]>
  delete(repositoryId: string): Promise<boolean>
}
