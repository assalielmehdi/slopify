export type ClickUpClientOperation = 'CONFIGURE' | 'GET_TASK' | 'LIST_COMMENTS'

export type ClickUpClientErrorCode =
  | 'CLIENT_CONFIGURATION_INVALID'
  | 'INVALID_RESPONSE'
  | 'PAGINATION_LIMIT_REACHED'
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'REQUEST_TIMEOUT'
  | 'TASK_NOT_FOUND'
  | 'UNAUTHORIZED'

const messages: Readonly<Record<ClickUpClientErrorCode, string>> = {
  CLIENT_CONFIGURATION_INVALID: 'ClickUp client configuration is invalid',
  INVALID_RESPONSE: 'ClickUp returned an invalid response',
  PAGINATION_LIMIT_REACHED: 'ClickUp comment pagination exceeded its configured limit',
  PROVIDER_UNAVAILABLE: 'ClickUp is unavailable',
  RATE_LIMITED: 'ClickUp rate limit was reached',
  REQUEST_TIMEOUT: 'ClickUp request timed out',
  TASK_NOT_FOUND: 'ClickUp task was not found',
  UNAUTHORIZED: 'ClickUp authorization failed',
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
