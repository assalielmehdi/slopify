import { WorkflowIdSchema } from '@slopify/contracts'
import { WorkflowSchema, type Workflow } from '@slopify/workflow-model'

import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'
import { mapPersistenceError, PersistenceError } from './errors.js'

export interface WorkflowRepository {
  insert(workflow: Workflow): void
  save(workflow: Workflow): void
  get(workflowId: string): Workflow | undefined
  list(): readonly Workflow[]
}

interface WorkflowRow {
  readonly definition_json: string
}

const isConstraintError = (cause: unknown): boolean =>
  typeof cause === 'object' &&
  cause !== null &&
  'code' in cause &&
  typeof cause.code === 'string' &&
  cause.code.startsWith('SQLITE_CONSTRAINT')

export const createWorkflowRepository = (database: WorkbenchDatabase): WorkflowRepository => {
  const connection = getDatabaseHandle(database)

  const get = (workflowIdInput: string): Workflow | undefined => {
    const workflowId = WorkflowIdSchema.parse(workflowIdInput)
    const row = connection
      .prepare(
        `SELECT definition_json
         FROM workflows
         WHERE workflow_id = ?`,
      )
      .get(workflowId) as WorkflowRow | undefined
    return row === undefined ? undefined : WorkflowSchema.parse(JSON.parse(row.definition_json))
  }

  return {
    insert(workflowInput) {
      const workflow = WorkflowSchema.parse(workflowInput)
      try {
        connection
          .prepare(
            `INSERT INTO workflows (workflow_id, definition_json)
             VALUES (?, ?)`,
          )
          .run(workflow.workflowId, JSON.stringify(workflow))
      } catch (cause) {
        if (isConstraintError(cause)) {
          throw new PersistenceError({
            code: 'PERSISTENCE_CONFLICT',
            message: 'Workflow already exists',
            cause,
          })
        }
        throw mapPersistenceError(cause, 'Could not persist workflow')
      }
    },
    save(workflowInput) {
      const workflow = WorkflowSchema.parse(workflowInput)
      try {
        connection
          .prepare(
            `INSERT INTO workflows (workflow_id, definition_json)
             VALUES (?, ?)
             ON CONFLICT (workflow_id) DO UPDATE SET
               definition_json = excluded.definition_json`,
          )
          .run(workflow.workflowId, JSON.stringify(workflow))
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not persist workflow')
      }
    },
    get,
    list() {
      const rows = connection
        .prepare(
          `SELECT definition_json
           FROM workflows
           ORDER BY json_extract(definition_json, '$.updatedAt') DESC, workflow_id`,
        )
        .all() as WorkflowRow[]
      return rows.map((row) => WorkflowSchema.parse(JSON.parse(row.definition_json)))
    },
  }
}
