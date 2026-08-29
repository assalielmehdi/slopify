import { GitProviderSchema, RepositoryIdSchema } from '@slopify/shared'

import {
  createAtomicJsonResourceIO,
  type AtomicJsonResourceIO,
} from '../filesystem/atomic-json-resource.js'
import { FilesystemResourceError } from '../filesystem/filesystem-errors.js'
import type { ResourceRevision } from '../filesystem/resource-revision.js'
import type { SlopifyPaths } from '../filesystem/slopify-home.js'
import {
  RepositoryCollectionSchema,
  RepositoryRecordSchema,
  RepositoryStoreError,
  type RepositoryCollection,
  type RepositoryStore,
} from './repository-store.js'

const MAX_REPOSITORIES_BYTES = 4_194_304

const emptyCollection = (): RepositoryCollection =>
  RepositoryCollectionSchema.parse({ schemaVersion: 1, repositories: [] })

const storeError = (cause: unknown): RepositoryStoreError => {
  if (cause instanceof RepositoryStoreError) return cause
  if (cause instanceof FilesystemResourceError) {
    if (cause.code === 'RESOURCE_REVISION_CONFLICT') {
      return new RepositoryStoreError(
        'REPOSITORIES_REVISION_CONFLICT',
        'Repositories changed since they were read',
        cause,
      )
    }
    if (
      cause.code === 'RESOURCE_MALFORMED' ||
      cause.code === 'RESOURCE_VALIDATION_FAILED' ||
      cause.code === 'RESOURCE_TOO_LARGE' ||
      cause.code === 'RESOURCE_SYMLINK_NOT_ALLOWED' ||
      cause.code === 'RESOURCE_NOT_FILE'
    ) {
      return new RepositoryStoreError(
        'REPOSITORIES_FILE_INVALID',
        'Repositories file is invalid',
        cause,
      )
    }
  }
  return new RepositoryStoreError('REPOSITORIES_UNAVAILABLE', 'Repositories are unavailable', cause)
}

export const createFilesystemRepositoryStore = (
  options: Readonly<{
    paths: Pick<SlopifyPaths, 'repositoriesFile'>
    resources?: AtomicJsonResourceIO
  }>,
): RepositoryStore => {
  const resources = options.resources ?? createAtomicJsonResourceIO()
  let mutationTail = Promise.resolve()

  const mutate = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const previous = mutationTail
    let release: (() => void) | undefined
    mutationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release?.()
    }
  }

  const read = async () => {
    try {
      return await resources.readVersioned({
        path: options.paths.repositoriesFile,
        schema: RepositoryCollectionSchema,
        maxBytes: MAX_REPOSITORIES_BYTES,
      })
    } catch (cause) {
      if (cause instanceof FilesystemResourceError && cause.code === 'RESOURCE_NOT_FOUND') {
        return { value: emptyCollection(), revision: null }
      }
      throw storeError(cause)
    }
  }

  const write = async (value: RepositoryCollection, expectedRevision: ResourceRevision | null) => {
    try {
      await resources.writeVersioned({
        path: options.paths.repositoriesFile,
        schema: RepositoryCollectionSchema,
        value,
        expectedRevision,
        maxBytes: MAX_REPOSITORIES_BYTES,
      })
    } catch (cause) {
      throw storeError(cause)
    }
  }

  const deleteRepository = async (repositoryIdInput: string): Promise<boolean> => {
    const repositoryId = RepositoryIdSchema.parse(repositoryIdInput)
    const snapshot = await read()
    const repositories = snapshot.value.repositories.filter(
      (repository) => repository.repositoryId !== repositoryId,
    )
    if (repositories.length === snapshot.value.repositories.length) return false
    await write({ ...snapshot.value, repositories }, snapshot.revision)
    return true
  }

  return {
    async add(input) {
      await mutate(async () => {
        const repository = RepositoryRecordSchema.parse(input)
        const snapshot = await read()
        if (
          snapshot.value.repositories.some(
            (candidate) =>
              candidate.repositoryId === repository.repositoryId ||
              (candidate.provider === repository.provider &&
                candidate.remoteId === repository.remoteId),
          )
        ) {
          throw new RepositoryStoreError('REPOSITORY_CONFLICT', 'Repository already exists')
        }
        await write(
          {
            ...snapshot.value,
            repositories: [...snapshot.value.repositories, repository],
          },
          snapshot.revision,
        )
      })
    },

    async get(repositoryIdInput) {
      const repositoryId = RepositoryIdSchema.parse(repositoryIdInput)
      return (await read()).value.repositories.find(
        (repository) => repository.repositoryId === repositoryId,
      )
    },

    async findByRemote(providerInput, remoteId) {
      const provider = GitProviderSchema.parse(providerInput)
      return (await read()).value.repositories.find(
        (repository) => repository.provider === provider && repository.remoteId === remoteId,
      )
    },

    async list() {
      return (await read()).value.repositories
    },

    delete: (repositoryId) => mutate(() => deleteRepository(repositoryId)),
  }
}
