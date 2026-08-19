import type { JsonValue } from '@loop/execution-runtime'

export type DeliveryErrorCode =
  | 'DELIVERY_ARTIFACT_INVALID'
  | 'DELIVERY_CONTEXT_INVALID'
  | 'DELIVERY_DUPLICATE_MERGE_REQUEST'
  | 'DELIVERY_GITLAB_CREATE_FAILED'
  | 'DELIVERY_GITLAB_DISCOVERY_FAILED'
  | 'DELIVERY_GIT_PRECONDITION_FAILED'
  | 'DELIVERY_INPUT_INVALID'
  | 'DELIVERY_MERGE_REQUEST_READBACK_FAILED'
  | 'DELIVERY_PERSISTENCE_FAILED'
  | 'DELIVERY_PUSH_FAILED'
  | 'DELIVERY_SELECTION_MISMATCH'

export interface DeliveryError {
  readonly code: DeliveryErrorCode
  readonly message: string
  readonly repositoryId?: string
  readonly evidence?: JsonValue
}
