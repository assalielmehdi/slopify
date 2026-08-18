export type ClickUpClientOperation =
  | 'CONFIGURE'
  | 'CREATE_COMMENT'
  | 'GET_TASK'
  | 'LIST_COMMENTS'
  | 'UPDATE_COMMENT'
  | 'UPDATE_TASK'

export type ClickUpArtifactOperation =
  | 'CONFIGURE_ARTIFACTS'
  | 'GET_ARTIFACT'
  | 'LIST_ARTIFACTS'
  | 'PUBLISH_ARTIFACT'
  | 'RENDER_ARTIFACT'
  | 'UPDATE_REVIEW_SUMMARY'
  | 'MOVE_TO_IN_REVIEW'

export type ClickUpArtifactErrorCode =
  | 'ARTIFACT_AMBIGUOUS'
  | 'ARTIFACT_INPUT_INVALID'
  | 'ARTIFACT_NOT_FOUND'
  | 'COMMENT_REJECTED'
  | 'STATUS_TRANSITION_FAILED'

export type ClickUpClientErrorCode =
  | 'CLIENT_CONFIGURATION_INVALID'
  | 'COMMENT_REJECTED'
  | 'INVALID_RESPONSE'
  | 'PAGINATION_LIMIT_REACHED'
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'REQUEST_TIMEOUT'
  | 'STATUS_TRANSITION_FAILED'
  | 'TASK_NOT_FOUND'
  | 'UNAUTHORIZED'

const messages: Readonly<Record<ClickUpClientErrorCode, string>> = {
  CLIENT_CONFIGURATION_INVALID: 'ClickUp client configuration is invalid',
  COMMENT_REJECTED: 'ClickUp rejected the comment',
  INVALID_RESPONSE: 'ClickUp returned an invalid response',
  PAGINATION_LIMIT_REACHED: 'ClickUp comment pagination exceeded its configured limit',
  PROVIDER_UNAVAILABLE: 'ClickUp is unavailable',
  RATE_LIMITED: 'ClickUp rate limit was reached',
  REQUEST_TIMEOUT: 'ClickUp request timed out',
  STATUS_TRANSITION_FAILED: 'ClickUp rejected the status transition',
  TASK_NOT_FOUND: 'ClickUp task was not found',
  UNAUTHORIZED: 'ClickUp authorization failed',
}

export interface ClickUpArtifactErrorContext {
  readonly taskId?: string
  readonly runId?: string
  readonly artifactType?: string
  readonly commentIds?: readonly string[]
}

const artifactMessages: Readonly<Record<ClickUpArtifactErrorCode, string>> = {
  ARTIFACT_AMBIGUOUS: 'Multiple exact ClickUp artifacts were found',
  ARTIFACT_INPUT_INVALID: 'ClickUp artifact input is invalid',
  ARTIFACT_NOT_FOUND: 'ClickUp artifact was not found',
  COMMENT_REJECTED: 'ClickUp artifact comment was rejected',
  STATUS_TRANSITION_FAILED: 'ClickUp artifact status transition failed',
}

export class ClickUpClientError extends Error {
  override readonly name = 'ClickUpClientError'

  constructor(
    readonly code: ClickUpClientErrorCode,
    readonly operation: ClickUpClientOperation,
  ) {
    super(messages[code])
  }
}

export class ClickUpArtifactError extends Error {
  override readonly name = 'ClickUpArtifactError'

  constructor(
    readonly code: ClickUpArtifactErrorCode,
    readonly operation: ClickUpArtifactOperation,
    readonly context?: ClickUpArtifactErrorContext,
  ) {
    super(artifactMessages[code])
  }
}
