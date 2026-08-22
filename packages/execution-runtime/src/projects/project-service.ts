import { isAbsolute, resolve } from 'node:path'
import {
  AddProjectRequestSchema,
  ProjectIdSchema,
  ProjectSchema,
  type Project,
} from '@loop/contracts'

import { PersistenceError } from '../persistence/errors.js'
import type { ProjectRecord, ProjectRepository } from './project-repository.js'

export type ProjectInspection =
  | Readonly<{ status: 'AVAILABLE'; canonicalPath: string; name: string }>
  | Readonly<{ status: 'MISSING' }>
  | Readonly<{ status: 'NOT_GIT_REPOSITORY' }>

export interface ProjectInspector {
  inspect(repositoryPath: string): Promise<ProjectInspection>
}

export type ProjectServiceErrorCode =
  | 'PROJECT_INVALID'
  | 'PROJECT_PATH_NOT_FOUND'
  | 'PROJECT_NOT_GIT_REPOSITORY'
  | 'PROJECT_PATH_CONFLICT'
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
  add(input: unknown): Promise<Project>
  delete(projectId: string): Promise<void>
  list(): Promise<readonly Project[]>
  requireAvailable(projectId: string): Promise<Project>
}

export interface CreateProjectServiceOptions {
  readonly projects: ProjectRepository
  readonly inspector: ProjectInspector
  readonly createId?: () => string
  readonly now?: () => string
}

const unavailableError = () =>
  new ProjectServiceError('PROJECT_UNAVAILABLE', "Project can't be found in the file system")

export const createProjectService = (options: CreateProjectServiceOptions): ProjectService => {
  const createId = options.createId ?? (() => `project-${crypto.randomUUID()}`)
  const now = options.now ?? (() => new Date().toISOString())

  const inspectRecord = async (record: ProjectRecord): Promise<Project> => {
    const inspection = await options.inspector.inspect(record.repositoryPath)
    return ProjectSchema.parse({
      ...record,
      availability: inspection.status,
    })
  }

  return {
    async add(input) {
      const result = AddProjectRequestSchema.safeParse(input)
      if (!result.success || !isAbsolute(result.data.repositoryPath)) {
        throw new ProjectServiceError('PROJECT_INVALID', 'Project path must be absolute')
      }

      const inspection = await options.inspector.inspect(resolve(result.data.repositoryPath))
      if (inspection.status === 'MISSING') {
        throw new ProjectServiceError('PROJECT_PATH_NOT_FOUND', 'Project path could not be found')
      }
      if (inspection.status === 'NOT_GIT_REPOSITORY') {
        throw new ProjectServiceError(
          'PROJECT_NOT_GIT_REPOSITORY',
          'Project path must be a Git repository',
        )
      }
      if (options.projects.findByPath(inspection.canonicalPath) !== undefined) {
        throw new ProjectServiceError('PROJECT_PATH_CONFLICT', 'Project already exists')
      }

      const timestamp = now()
      const record = {
        projectId: ProjectIdSchema.parse(createId()),
        name: inspection.name,
        repositoryPath: inspection.canonicalPath,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      try {
        options.projects.add(record)
      } catch (cause) {
        if (cause instanceof PersistenceError && cause.code === 'PERSISTENCE_CONFLICT') {
          throw new ProjectServiceError('PROJECT_PATH_CONFLICT', 'Project already exists')
        }
        throw cause
      }
      return ProjectSchema.parse({ ...record, availability: 'AVAILABLE' })
    },

    async list() {
      return Promise.all(options.projects.list().map(inspectRecord))
    },

    async delete(projectIdInput) {
      const projectId = ProjectIdSchema.parse(projectIdInput)
      if (!options.projects.delete(projectId)) {
        throw new ProjectServiceError('PROJECT_NOT_FOUND', 'Project was not found')
      }
    },

    async requireAvailable(projectIdInput) {
      const projectId = ProjectIdSchema.parse(projectIdInput)
      const record = options.projects.get(projectId)
      if (record === undefined) {
        throw new ProjectServiceError('PROJECT_NOT_FOUND', 'Project was not found')
      }
      const project = await inspectRecord(record)
      if (project.availability !== 'AVAILABLE') throw unavailableError()
      return project
    },
  }
}
