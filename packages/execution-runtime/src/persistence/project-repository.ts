import { ProjectIdSchema } from '@loop/contracts'

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
         WHERE ${column} = ?`,
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
    delete(projectId) {
      return (
        connection
          .prepare('DELETE FROM projects WHERE project_id = ?')
          .run(ProjectIdSchema.parse(projectId)).changes > 0
      )
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
             ORDER BY created_at, project_id`,
          )
          .all() as ProjectRow[]
      ).map(parseRow)
    },
  }
}
