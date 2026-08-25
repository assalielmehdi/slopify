import type { WorkflowFile } from '@slopify/workflow-model'

import type { ResourceRevision } from '../filesystem/resource-revision.js'

export type WorkflowDiagnosticCode =
  | 'WORKFLOW_DIRECTORY_INVALID'
  | 'WORKFLOW_FILE_MISSING'
  | 'WORKFLOW_FILE_MALFORMED'
  | 'WORKFLOW_FILE_INVALID'
  | 'WORKFLOW_ID_MISMATCH'
  | 'WORKFLOW_GRAPH_INVALID'
  | 'WORKFLOW_ENTRY_UNAVAILABLE'

export interface WorkflowDiagnostic {
  readonly code: WorkflowDiagnosticCode
  readonly message: string
  readonly path: readonly (string | number)[]
}

export type WorkflowStoreEntry =
  | Readonly<{
      status: 'VALID'
      workflowId: string
      value: WorkflowFile
      revision: ResourceRevision
    }>
  | Readonly<{
      status: 'INVALID'
      workflowId: string
      diagnostics: readonly WorkflowDiagnostic[]
    }>

export interface VersionedWorkflowFile {
  readonly value: WorkflowFile
  readonly revision: ResourceRevision
}

export type WorkflowStoreErrorCode =
  'WORKFLOW_CONFLICT' | 'WORKFLOW_FILE_INVALID' | 'WORKFLOW_UNAVAILABLE'

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
  get(workflowId: string): Promise<WorkflowStoreEntry | undefined>
  list(): Promise<readonly WorkflowStoreEntry[]>
}
