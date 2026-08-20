import { isAbsolute, relative, resolve } from 'node:path'
import {
  ProjectProfileConfigurationSchema,
  ProjectProfileIdSchema,
  ProjectProfileRuntimeBoundarySchema,
  type ProjectProfileConfiguration as ValidatedProjectProfileConfiguration,
  type ProjectProfileRuntimeBoundary,
} from '@loop/contracts'

import type {
  ProfileRepository,
  ProjectProfileConfiguration,
  ProjectProfileSnapshot,
} from '../persistence/profile-repository.js'

export type ProjectProfileServiceErrorCode = 'PROFILE_INVALID' | 'PROFILE_NOT_FOUND'

export class ProjectProfileServiceError extends Error {
  readonly code: ProjectProfileServiceErrorCode

  constructor(
    code: ProjectProfileServiceErrorCode,
    message: string,
    options?: Readonly<{ cause?: unknown }>,
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ProjectProfileServiceError'
    this.code = code
  }
}

export interface ProjectProfileService {
  save(input: unknown): ValidatedProjectProfileConfiguration
  get(profileId: string): ValidatedProjectProfileConfiguration | undefined
  list(): readonly ValidatedProjectProfileConfiguration[]
  runtimeBoundary(): ProjectProfileRuntimeBoundary
  createSnapshot(profileId: string, snapshotId: string): ProjectProfileSnapshot
}

export interface CreateProjectProfileServiceOptions {
  readonly profiles: ProfileRepository
  readonly runtimeMode: 'native' | 'container'
  readonly workspaceRoot?: string
  readonly now?: () => string
}

const isWithin = (root: string, path: string): boolean => {
  const pathFromRoot = relative(root, path)
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
}

export const createProjectProfileService = (
  options: CreateProjectProfileServiceOptions,
): ProjectProfileService => {
  const now = options.now ?? (() => new Date().toISOString())
  const workspaceRoot = resolve(options.workspaceRoot ?? '/workspace')
  const runtimeBoundary = ProjectProfileRuntimeBoundarySchema.parse({
    mode: options.runtimeMode,
    root: options.runtimeMode === 'container' ? workspaceRoot : '/',
  })

  const validate = (input: unknown): ValidatedProjectProfileConfiguration => {
    const result = ProjectProfileConfigurationSchema.safeParse(input)
    if (!result.success) {
      throw new ProjectProfileServiceError('PROFILE_INVALID', 'Project profile is invalid')
    }
    const repositoryIds = new Set<string>()
    const repositoryPaths = new Set<string>()
    for (const repository of result.data.repositories) {
      if (repositoryIds.has(repository.repositoryId)) {
        throw new ProjectProfileServiceError('PROFILE_INVALID', 'Repository IDs must be unique')
      }
      repositoryIds.add(repository.repositoryId)
      if (!isAbsolute(repository.repositoryPath) || !isAbsolute(repository.worktreeParent)) {
        throw new ProjectProfileServiceError('PROFILE_INVALID', 'Repository paths must be absolute')
      }
      const repositoryPath = resolve(repository.repositoryPath)
      const worktreeParent = resolve(repository.worktreeParent)
      if (repositoryPaths.has(repositoryPath)) {
        throw new ProjectProfileServiceError('PROFILE_INVALID', 'Repository paths must be unique')
      }
      repositoryPaths.add(repositoryPath)
      if (
        options.runtimeMode === 'container' &&
        (!isWithin(workspaceRoot, repositoryPath) || !isWithin(workspaceRoot, worktreeParent))
      ) {
        throw new ProjectProfileServiceError(
          'PROFILE_INVALID',
          'Container paths must be inside the workspace root',
        )
      }
    }
    return result.data
  }

  return {
    save(input) {
      const profile = validate(input)
      options.profiles.save(profile as ProjectProfileConfiguration, now())
      return profile
    },
    get(profileIdInput) {
      const profileId = ProjectProfileIdSchema.parse(profileIdInput)
      const profile = options.profiles.get(profileId)
      return profile === undefined ? undefined : ProjectProfileConfigurationSchema.parse(profile)
    },
    list() {
      return options.profiles
        .list()
        .map((profile) => ProjectProfileConfigurationSchema.parse(profile))
    },
    runtimeBoundary() {
      return runtimeBoundary
    },
    createSnapshot(profileIdInput, snapshotId) {
      const profileId = ProjectProfileIdSchema.parse(profileIdInput)
      if (options.profiles.get(profileId) === undefined) {
        throw new ProjectProfileServiceError('PROFILE_NOT_FOUND', 'Project profile was not found')
      }
      return options.profiles.createSnapshot({ snapshotId, profileId, createdAt: now() })
    },
  }
}
