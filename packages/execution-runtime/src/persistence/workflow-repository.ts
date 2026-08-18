import { WorkflowIdSchema, RevisionIdSchema } from '@loop/contracts'
import { WorkflowRevisionSchema, type WorkflowRevision } from '@loop/workflow-model'

import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'
import { mapPersistenceError, PersistenceError } from './errors.js'

export interface WorkflowRevisionReference {
  readonly workflowId: string
  readonly revisionId: string
}

export interface WorkflowRepository {
  addRevision(revision: WorkflowRevision): void
  getRevision(reference: WorkflowRevisionReference): WorkflowRevision | undefined
}

interface WorkflowRevisionRow {
  readonly definition_json: string
}

export const createWorkflowRepository = (database: WorkbenchDatabase): WorkflowRepository => {
  const connection = getDatabaseHandle(database)

  const getRevision = (reference: WorkflowRevisionReference): WorkflowRevision | undefined => {
    const workflowId = WorkflowIdSchema.parse(reference.workflowId)
    const revisionId = RevisionIdSchema.parse(reference.revisionId)
    const row = connection
      .prepare(
        `SELECT definition_json
         FROM workflow_revisions
         WHERE workflow_id = ? AND revision_id = ?`,
      )
      .get(workflowId, revisionId) as WorkflowRevisionRow | undefined

    return row === undefined
      ? undefined
      : WorkflowRevisionSchema.parse(JSON.parse(row.definition_json))
  }

  return {
    addRevision(revisionInput) {
      const revision = WorkflowRevisionSchema.parse(revisionInput)
      if (
        getRevision({ workflowId: revision.workflowId, revisionId: revision.revisionId }) !==
        undefined
      ) {
        throw new PersistenceError({
          code: 'PERSISTENCE_CONFLICT',
          message: 'Workflow revision already exists',
          details: {
            workflowId: revision.workflowId,
            revisionId: revision.revisionId,
          },
        })
      }

      try {
        connection
          .transaction(() => {
            connection
              .prepare(
                `INSERT INTO workflows (workflow_id, name, created_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT (workflow_id) DO NOTHING`,
              )
              .run(revision.workflowId, revision.name, revision.createdAt)
            connection
              .prepare(
                `INSERT INTO workflow_revisions (
                   revision_id, workflow_id, parent_revision_id, name,
                   definition_json, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?)`,
              )
              .run(
                revision.revisionId,
                revision.workflowId,
                revision.parentRevisionId ?? null,
                revision.name,
                JSON.stringify(revision),
                revision.createdAt,
              )
          })
          .immediate()
      } catch (cause) {
        throw mapPersistenceError(cause, 'Could not persist workflow revision')
      }
    },
    getRevision,
  }
}
