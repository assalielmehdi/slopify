export type WorkflowServiceErrorCode =
  | 'WORKFLOW_FILE_INVALID'
  | 'WORKFLOW_ID_CONFLICT'
  | 'WORKFLOW_ID_MISMATCH'
  | 'WORKFLOW_NAME_CONFLICT'
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_RUN_ACTIVE'
  | 'WORKFLOW_HARNESS_UNAVAILABLE'
  | 'WORKFLOW_REVISION_CONFLICT'
  | 'WORKFLOW_UNAVAILABLE'

export class WorkflowServiceError extends Error {
  override readonly name = 'WorkflowServiceError'

  constructor(
    readonly code: WorkflowServiceErrorCode,
    message: string,
  ) {
    super(message)
  }
}
