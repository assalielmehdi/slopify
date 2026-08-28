import type { WorkflowFile } from '@slopify/workflow-model'

import type { ResourceRevision } from '../filesystem/resource-revision.js'
import type { WorkflowSource } from './workflow-source.js'

export type WorkflowStoreEntry = WorkflowSource

export interface VersionedWorkflowFile {
  readonly value: WorkflowFile
  readonly revision: ResourceRevision
}

export type WorkflowStoreErrorCode =
  | 'WORKFLOW_CONFLICT'
  | 'WORKFLOW_FILE_INVALID'
  | 'WORKFLOW_ID_MISMATCH'
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_REVISION_CONFLICT'
  | 'WORKFLOW_UNAVAILABLE'

export class WorkflowStoreError extends Error {
  override readonly name = 'WorkflowStoreError'

  constructor(
    readonly code: WorkflowStoreErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
  }
}

export interface WorkflowStore {
  create(workflow: WorkflowFile): Promise<VersionedWorkflowFile>
  delete(workflowId: string): Promise<boolean>
  save(input: {
    readonly workflowId: string
    readonly value: WorkflowFile
    readonly expectedRevision: ResourceRevision | null
  }): Promise<VersionedWorkflowFile>
  get(workflowId: string): Promise<WorkflowStoreEntry | undefined>
  list(): Promise<readonly WorkflowStoreEntry[]>
}
