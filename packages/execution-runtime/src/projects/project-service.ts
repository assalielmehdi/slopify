import {
  AddProjectRequestSchema,
  DeletionIdSchema,
  DeletionReceiptSchema,
  ProjectIdSchema,
  ProjectSchema,
  type DeletionReceipt,
  type Project,
} from '@slopify/contracts'

import {
  GitConnectionServiceError,
  type GitConnectionService,
} from '../git/git-connection-service.js'
import type { RemoteGitHost } from '../git/remote-git-host.js'
import { PersistenceError } from '../persistence/errors.js'
import type { ProjectRecord, ProjectRepository } from './project-repository.js'

export type ProjectServiceErrorCode =
  | 'PROJECT_INVALID'
  | 'PROJECT_CONNECTION_REQUIRED'
  | 'PROJECT_REPOSITORY_NOT_FOUND'
  | 'PROJECT_REMOTE_CONFLICT'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_UNAVAILABLE'

export class ProjectServiceError extends Error {
  readonly code: ProjectServiceErrorCode

  constructor(code: ProjectServiceErrorCode, message: string) {
    super(message)
    this.name = 'ProjectServiceError'
    this.code = code
  }
}

export interface ProjectService {
  readonly subjectType: 'PROJECT'
  add(input: unknown): Promise<Project>
  delete(projectId: string): Promise<DeletionReceipt>
  list(): Promise<readonly Project[]>
  requireAvailable(projectId: string): Promise<Project>
  undoDeletion(deletionId: string): Promise<'UNDONE' | 'EXPIRED' | 'NOT_FOUND'>
}

export interface CreateProjectServiceOptions {
  readonly projects: ProjectRepository
  readonly connections: Pick<GitConnectionService, 'requireToken'>
  readonly remote: RemoteGitHost
  readonly createId?: () => string
  readonly createDeletionId?: () => string
  readonly now?: () => string
  readonly undoWindowMs?: number
}

const unavailableError = () =>
  new ProjectServiceError('PROJECT_UNAVAILABLE', 'Project repository is unavailable')

export const createProjectService = (options: CreateProjectServiceOptions): ProjectService => {
  const createId = options.createId ?? (() => `project-${crypto.randomUUID()}`)
  const createDeletionId = options.createDeletionId ?? (() => `deletion-${crypto.randomUUID()}`)
  const now = options.now ?? (() => new Date().toISOString())
  const undoWindowMs = options.undoWindowMs ?? 10_000

  const purgeExpired = () => options.projects.purgeExpired(now())

  const inspectRecord = async (record: ProjectRecord): Promise<Project> => {
    let token: string
    try {
      token = await options.connections.requireToken(record.provider)
    } catch (cause) {
      if (cause instanceof GitConnectionServiceError) {
        return ProjectSchema.parse({ ...record, availability: 'CONNECTION_MISSING' })
      }
      throw cause
    }
    try {
      const repository = await options.remote.getRepository(record.provider, token, record.remoteId)
      return ProjectSchema.parse({
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
      return ProjectSchema.parse({ ...record, availability: 'REPOSITORY_UNAVAILABLE' })
    }
  }

  return {
    subjectType: 'PROJECT',
    async add(input) {
      purgeExpired()
      const result = AddProjectRequestSchema.safeParse(input)
      if (!result.success) throw new ProjectServiceError('PROJECT_INVALID', 'Project is invalid')
      const { provider, remoteId } = result.data
      if (options.projects.findByRemote(provider, remoteId) !== undefined) {
        throw new ProjectServiceError('PROJECT_REMOTE_CONFLICT', 'Project already exists')
      }
      let token: string
      try {
        token = await options.connections.requireToken(provider)
      } catch (cause) {
        if (cause instanceof GitConnectionServiceError) {
          throw new ProjectServiceError(
            'PROJECT_CONNECTION_REQUIRED',
            `${provider === 'GITHUB' ? 'GitHub' : 'GitLab'} must be connected first`,
          )
        }
        throw cause
      }
      const repository = await options.remote.getRepository(provider, token, remoteId)
      if (repository === undefined) {
        throw new ProjectServiceError(
          'PROJECT_REPOSITORY_NOT_FOUND',
          'Repository could not be found',
        )
      }

      const timestamp = now()
      const record: ProjectRecord = {
        projectId: ProjectIdSchema.parse(createId()),
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
        options.projects.add(record)
      } catch (cause) {
        if (cause instanceof PersistenceError && cause.code === 'PERSISTENCE_CONFLICT') {
          throw new ProjectServiceError('PROJECT_REMOTE_CONFLICT', 'Project already exists')
        }
        throw cause
      }
      return ProjectSchema.parse({ ...record, availability: 'AVAILABLE' })
    },

    async list() {
      purgeExpired()
      return Promise.all(options.projects.list().map(inspectRecord))
    },

    async delete(projectIdInput) {
      purgeExpired()
      const projectId = ProjectIdSchema.parse(projectIdInput)
      const deletedAt = now()
      const receipt = DeletionReceiptSchema.parse({
        deletionId: DeletionIdSchema.parse(createDeletionId()),
        subject: { type: 'PROJECT', id: projectId },
        deletedAt,
        undoExpiresAt: new Date(Date.parse(deletedAt) + undoWindowMs).toISOString(),
      })
      if (!options.projects.stageDeletion(receipt)) {
        throw new ProjectServiceError('PROJECT_NOT_FOUND', 'Project was not found')
      }
      return receipt
    },

    async requireAvailable(projectIdInput) {
      purgeExpired()
      const projectId = ProjectIdSchema.parse(projectIdInput)
      const record = options.projects.get(projectId)
      if (record === undefined) {
        throw new ProjectServiceError('PROJECT_NOT_FOUND', 'Project was not found')
      }
      const project = await inspectRecord(record)
      if (project.availability !== 'AVAILABLE') throw unavailableError()
      return project
    },

    async undoDeletion(deletionId) {
      return options.projects.restoreDeletion(DeletionIdSchema.parse(deletionId), now())
    },
  }
}
