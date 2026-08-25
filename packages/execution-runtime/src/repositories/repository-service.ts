import {
  AddRepositoryRequestSchema,
  RepositoryIdSchema,
  RepositorySchema,
  type Repository,
} from '@slopify/contracts'

import {
  GitConnectionServiceError,
  type GitConnectionService,
} from '../git/git-connection-service.js'
import type { RemoteGitHost } from '../git/remote-git-host.js'
import { PersistenceError } from '../persistence/errors.js'
import {
  RepositoryStoreError,
  type RepositoryRecord,
  type RepositoryStore,
} from './repository-store.js'

export type RepositoryServiceErrorCode =
  | 'REPOSITORY_INVALID'
  | 'REPOSITORY_CONNECTION_REQUIRED'
  | 'REPOSITORY_REMOTE_NOT_FOUND'
  | 'REPOSITORY_REMOTE_CONFLICT'
  | 'REPOSITORY_NOT_FOUND'
  | 'REPOSITORY_UNAVAILABLE'

export class RepositoryServiceError extends Error {
  readonly code: RepositoryServiceErrorCode

  constructor(code: RepositoryServiceErrorCode, message: string) {
    super(message)
    this.name = 'RepositoryServiceError'
    this.code = code
  }
}

export interface RepositoryService {
  add(input: unknown): Promise<Repository>
  delete(repositoryId: string): Promise<void>
  list(): Promise<readonly Repository[]>
  requireAvailable(repositoryId: string): Promise<Repository>
}

export interface CreateRepositoryServiceOptions {
  readonly repositories: RepositoryStore
  readonly connections: Pick<GitConnectionService, 'requireToken'>
  readonly remote: RemoteGitHost
  readonly createId?: () => string
  readonly now?: () => string
}

const unavailableError = () =>
  new RepositoryServiceError('REPOSITORY_UNAVAILABLE', 'Repository is unavailable')

export const createRepositoryService = (
  options: CreateRepositoryServiceOptions,
): RepositoryService => {
  const createId = options.createId ?? (() => `repository-${crypto.randomUUID()}`)
  const now = options.now ?? (() => new Date().toISOString())

  const inspectRecord = async (record: RepositoryRecord): Promise<Repository> => {
    let token: string
    try {
      token = await options.connections.requireToken(record.provider)
    } catch (cause) {
      if (cause instanceof GitConnectionServiceError) {
        return RepositorySchema.parse({ ...record, availability: 'CONNECTION_MISSING' })
      }
      throw cause
    }
    try {
      const repository = await options.remote.getRepository(record.provider, token, record.remoteId)
      return RepositorySchema.parse({
        ...record,
        ...(repository === undefined
          ? { availability: 'REPOSITORY_UNAVAILABLE' as const }
          : {
              name: repository.name,
              fullName: repository.fullName,
              cloneUrl: repository.cloneUrl,
              webUrl: repository.webUrl,
              defaultBranch: repository.defaultBranch,
              availability: 'AVAILABLE' as const,
            }),
      })
    } catch {
      return RepositorySchema.parse({ ...record, availability: 'REPOSITORY_UNAVAILABLE' })
    }
  }

  return {
    async add(input) {
      const result = AddRepositoryRequestSchema.safeParse(input)
      if (!result.success)
        throw new RepositoryServiceError('REPOSITORY_INVALID', 'Repository is invalid')
      const { provider, remoteId } = result.data
      if ((await options.repositories.findByRemote(provider, remoteId)) !== undefined) {
        throw new RepositoryServiceError('REPOSITORY_REMOTE_CONFLICT', 'Repository already exists')
      }
      let token: string
      try {
        token = await options.connections.requireToken(provider)
      } catch (cause) {
        if (cause instanceof GitConnectionServiceError) {
          throw new RepositoryServiceError(
            'REPOSITORY_CONNECTION_REQUIRED',
            `${provider === 'GITHUB' ? 'GitHub' : 'GitLab'} must be connected first`,
          )
        }
        throw cause
      }
      const repository = await options.remote.getRepository(provider, token, remoteId)
      if (repository === undefined) {
        throw new RepositoryServiceError(
          'REPOSITORY_REMOTE_NOT_FOUND',
          'Repository could not be found',
        )
      }

      const timestamp = now()
      const record: RepositoryRecord = {
        repositoryId: RepositoryIdSchema.parse(createId()),
        name: repository.name,
        provider: repository.provider,
        remoteId: repository.remoteId,
        fullName: repository.fullName,
        cloneUrl: repository.cloneUrl,
        webUrl: repository.webUrl,
        defaultBranch: repository.defaultBranch,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      try {
        await options.repositories.add(record)
      } catch (cause) {
        if (
          (cause instanceof PersistenceError && cause.code === 'PERSISTENCE_CONFLICT') ||
          (cause instanceof RepositoryStoreError && cause.code === 'REPOSITORY_CONFLICT')
        ) {
          throw new RepositoryServiceError(
            'REPOSITORY_REMOTE_CONFLICT',
            'Repository already exists',
          )
        }
        throw cause
      }
      return RepositorySchema.parse({ ...record, availability: 'AVAILABLE' })
    },

    async list() {
      return Promise.all((await options.repositories.list()).map(inspectRecord))
    },

    async delete(repositoryIdInput) {
      const repositoryId = RepositoryIdSchema.parse(repositoryIdInput)
      if (!(await options.repositories.delete(repositoryId))) {
        throw new RepositoryServiceError('REPOSITORY_NOT_FOUND', 'Repository was not found')
      }
    },

    async requireAvailable(repositoryIdInput) {
      const repositoryId = RepositoryIdSchema.parse(repositoryIdInput)
      const record = await options.repositories.get(repositoryId)
      if (record === undefined) {
        throw new RepositoryServiceError('REPOSITORY_NOT_FOUND', 'Repository was not found')
      }
      const repository = await inspectRecord(record)
      if (repository.availability !== 'AVAILABLE') throw unavailableError()
      return repository
    },
  }
}
