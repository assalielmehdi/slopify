import { ProjectProfileIdSchema, RepositoryIdSchema, type RepositoryId } from '@loop/contracts'

import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'
import { mapPersistenceError, PersistenceError } from './errors.js'
import { parseJson, serializeJson, type JsonValue } from './json.js'

export interface ProfileRepositoryConfiguration {
  readonly repositoryId: string
  readonly displayName: string
  readonly purpose: string
  readonly repositoryPath: string
  readonly gitlabProject: string
  readonly remote: string
  readonly targetBranch: string
  readonly worktreeParent: string
  readonly branchTemplate: string
  readonly executableChecks: readonly JsonValue[]
  readonly verificationCommands: readonly JsonValue[]
  readonly mergeRequestLabels: readonly string[]
}

export interface ProjectProfileConfiguration {
  readonly profileId: string
  readonly displayName: string
  readonly clickupWorkspaceId: string
  readonly clickupListId: string
  readonly clickupInReviewStatusId: string
  readonly repositories: readonly ProfileRepositoryConfiguration[]
}

export interface ProfileRepositorySnapshot extends Omit<
  ProfileRepositoryConfiguration,
  'repositoryId'
> {
  readonly repositoryId: RepositoryId
  readonly profilePosition: number
}

export interface ProjectProfileSnapshot {
  readonly snapshotId: string
  readonly profileId: string
  readonly displayName: string
  readonly clickupWorkspaceId: string
  readonly clickupListId: string
  readonly clickupInReviewStatusId: string
  readonly createdAt: string
  readonly repositories: readonly ProfileRepositorySnapshot[]
}

export interface CreateProfileSnapshotInput {
  readonly snapshotId: string
  readonly profileId: string
  readonly createdAt: string
}

export interface ProfileRepository {
  save(profile: ProjectProfileConfiguration, timestamp: string): void
  createSnapshot(input: CreateProfileSnapshotInput): ProjectProfileSnapshot
  getSnapshot(snapshotId: string): ProjectProfileSnapshot | undefined
}

interface ProfileRow {
  readonly profile_id: string
  readonly display_name: string
  readonly clickup_workspace_id: string
  readonly clickup_list_id: string
  readonly clickup_in_review_status_id: string
}

interface ProfileSnapshotRow extends ProfileRow {
  readonly snapshot_id: string
  readonly created_at: string
}

interface RepositoryRow {
  readonly repository_id: string
  readonly profile_position: number
  readonly display_name: string
  readonly purpose: string
  readonly repository_path: string
  readonly gitlab_project: string
  readonly remote: string
  readonly target_branch: string
  readonly worktree_parent: string
  readonly branch_template: string
  readonly executable_checks_json: string
  readonly verification_commands_json: string
  readonly merge_request_labels_json: string
}

const parseRepository = (row: RepositoryRow): ProfileRepositorySnapshot => ({
  repositoryId: RepositoryIdSchema.parse(row.repository_id),
  profilePosition: row.profile_position,
  displayName: row.display_name,
  purpose: row.purpose,
  repositoryPath: row.repository_path,
  gitlabProject: row.gitlab_project,
  remote: row.remote,
  targetBranch: row.target_branch,
  worktreeParent: row.worktree_parent,
  branchTemplate: row.branch_template,
  executableChecks: parseJson(row.executable_checks_json) as readonly JsonValue[],
  verificationCommands: parseJson(row.verification_commands_json) as readonly JsonValue[],
  mergeRequestLabels: parseJson(row.merge_request_labels_json) as readonly string[],
})

const validateProfile = (profile: ProjectProfileConfiguration): void => {
  ProjectProfileIdSchema.parse(profile.profileId)
  if (profile.repositories.length === 0) {
    throw new PersistenceError({
      code: 'PERSISTENCE_VALIDATION_FAILED',
      message: 'Project profile must contain at least one repository',
      details: { field: 'repositories' },
    })
  }

  const repositoryIds = profile.repositories.map(({ repositoryId }) =>
    RepositoryIdSchema.parse(repositoryId),
  )
  if (new Set(repositoryIds).size !== repositoryIds.length) {
    throw new PersistenceError({
      code: 'PERSISTENCE_VALIDATION_FAILED',
      message: 'Project profile repository IDs must be unique',
      details: { field: 'repositories' },
    })
  }
}

export const createProfileRepository = (database: WorkbenchDatabase): ProfileRepository => {
  const connection = getDatabaseHandle(database)

  const getSnapshot = (snapshotId: string): ProjectProfileSnapshot | undefined => {
    const row = connection
      .prepare(
        `SELECT snapshot_id, profile_id, display_name, clickup_workspace_id,
                clickup_list_id, clickup_in_review_status_id, created_at
         FROM project_profile_snapshots
         WHERE snapshot_id = ?`,
      )
      .get(snapshotId) as ProfileSnapshotRow | undefined
    if (row === undefined) return undefined

    const repositories = connection
      .prepare(
        `SELECT repository_id, profile_position, display_name, purpose,
                repository_path, gitlab_project, remote, target_branch,
                worktree_parent, branch_template, executable_checks_json,
                verification_commands_json, merge_request_labels_json
         FROM profile_snapshot_repositories
         WHERE snapshot_id = ?
         ORDER BY profile_position`,
      )
      .all(snapshotId) as RepositoryRow[]

    return {
      snapshotId: row.snapshot_id,
      profileId: ProjectProfileIdSchema.parse(row.profile_id),
      displayName: row.display_name,
      clickupWorkspaceId: row.clickup_workspace_id,
      clickupListId: row.clickup_list_id,
      clickupInReviewStatusId: row.clickup_in_review_status_id,
      createdAt: row.created_at,
      repositories: repositories.map(parseRepository),
    }
  }

  return {
    save(profile, timestamp) {
      validateProfile(profile)
      const repositoryRows = profile.repositories.map((repository, profilePosition) => ({
        ...repository,
        repositoryId: RepositoryIdSchema.parse(repository.repositoryId),
        profilePosition,
        executableChecksJson: serializeJson(
          repository.executableChecks,
          'repositories.executableChecks',
        ),
        verificationCommandsJson: serializeJson(
          repository.verificationCommands,
          'repositories.verificationCommands',
        ),
        mergeRequestLabelsJson: serializeJson(
          repository.mergeRequestLabels,
          'repositories.mergeRequestLabels',
        ),
      }))

      try {
        connection
          .transaction(() => {
            connection
              .prepare(
                `INSERT INTO project_profiles (
                   profile_id, display_name, clickup_workspace_id, clickup_list_id,
                   clickup_in_review_status_id, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (profile_id) DO UPDATE SET
                   display_name = excluded.display_name,
                   clickup_workspace_id = excluded.clickup_workspace_id,
                   clickup_list_id = excluded.clickup_list_id,
                   clickup_in_review_status_id = excluded.clickup_in_review_status_id,
                   updated_at = excluded.updated_at`,
              )
              .run(
                profile.profileId,
                profile.displayName,
                profile.clickupWorkspaceId,
                profile.clickupListId,
                profile.clickupInReviewStatusId,
                timestamp,
                timestamp,
              )
            connection
              .prepare('DELETE FROM project_profile_repositories WHERE profile_id = ?')
              .run(profile.profileId)
            const insertRepository = connection.prepare(
              `INSERT INTO project_profile_repositories (
                 profile_id, repository_id, profile_position, display_name, purpose,
                 repository_path, gitlab_project, remote, target_branch, worktree_parent,
                 branch_template, executable_checks_json, verification_commands_json,
                 merge_request_labels_json
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            for (const repository of repositoryRows) {
              insertRepository.run(
                profile.profileId,
                repository.repositoryId,
                repository.profilePosition,
                repository.displayName,
                repository.purpose,
                repository.repositoryPath,
                repository.gitlabProject,
                repository.remote,
                repository.targetBranch,
                repository.worktreeParent,
                repository.branchTemplate,
                repository.executableChecksJson,
                repository.verificationCommandsJson,
                repository.mergeRequestLabelsJson,
              )
            }
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not persist project profile')
      }
    },

    createSnapshot(input) {
      if (input.snapshotId.trim() === '') {
        throw new PersistenceError({
          code: 'PERSISTENCE_VALIDATION_FAILED',
          message: 'Profile snapshot ID must not be blank',
          details: { field: 'snapshotId' },
        })
      }
      const profileId = ProjectProfileIdSchema.parse(input.profileId)

      try {
        connection
          .transaction(() => {
            const profile = connection
              .prepare(
                `SELECT profile_id, display_name, clickup_workspace_id, clickup_list_id,
                        clickup_in_review_status_id
                 FROM project_profiles
                 WHERE profile_id = ?`,
              )
              .get(profileId) as ProfileRow | undefined
            if (profile === undefined) {
              throw new PersistenceError({
                code: 'PERSISTENCE_NOT_FOUND',
                message: 'Project profile was not found',
                details: { profileId },
              })
            }

            connection
              .prepare(
                `INSERT INTO project_profile_snapshots (
                   snapshot_id, profile_id, display_name, clickup_workspace_id,
                   clickup_list_id, clickup_in_review_status_id, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                input.snapshotId,
                profile.profile_id,
                profile.display_name,
                profile.clickup_workspace_id,
                profile.clickup_list_id,
                profile.clickup_in_review_status_id,
                input.createdAt,
              )
            connection
              .prepare(
                `INSERT INTO profile_snapshot_repositories (
                   snapshot_id, repository_id, profile_position, display_name, purpose,
                   repository_path, gitlab_project, remote, target_branch, worktree_parent,
                   branch_template, executable_checks_json, verification_commands_json,
                   merge_request_labels_json
                 )
                 SELECT ?, repository_id, profile_position, display_name, purpose,
                        repository_path, gitlab_project, remote, target_branch,
                        worktree_parent, branch_template, executable_checks_json,
                        verification_commands_json, merge_request_labels_json
                 FROM project_profile_repositories
                 WHERE profile_id = ?
                 ORDER BY profile_position`,
              )
              .run(input.snapshotId, profileId)
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not persist project profile snapshot')
      }

      const snapshot = getSnapshot(input.snapshotId)
      if (snapshot === undefined) {
        throw new PersistenceError({
          code: 'PERSISTENCE_READ_FAILED',
          message: 'Persisted project profile snapshot could not be read',
        })
      }
      return snapshot
    },

    getSnapshot,
  }
}
