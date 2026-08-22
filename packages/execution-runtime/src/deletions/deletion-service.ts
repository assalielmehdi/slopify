import {
  DeletionIdSchema,
  UndoDeletionResponseSchema,
  type DeletionReceipt,
  type UndoDeletionResponse,
} from '@slopify/contracts'

export type DeletionOperationState = 'PENDING' | 'UNDONE' | 'PURGED'

export interface DeletionOperation extends DeletionReceipt {
  readonly state: DeletionOperationState
}

export interface DeletionOperationRepository {
  get(deletionId: string): DeletionOperation | undefined
}

export interface ReversibleDeletionHandler {
  readonly subjectType: DeletionReceipt['subject']['type']
  undoDeletion(deletionId: string): Promise<'UNDONE' | 'EXPIRED' | 'NOT_FOUND'>
}

export type DeletionServiceErrorCode =
  'DELETION_NOT_FOUND' | 'DELETION_UNDO_EXPIRED' | 'DELETION_HANDLER_NOT_FOUND'

export class DeletionServiceError extends Error {
  override readonly name = 'DeletionServiceError'

  constructor(
    readonly code: DeletionServiceErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface DeletionService {
  undo(deletionId: string): Promise<UndoDeletionResponse>
}

export const createDeletionService = (
  options: Readonly<{
    operations: DeletionOperationRepository
    handlers: readonly ReversibleDeletionHandler[]
  }>,
): DeletionService => {
  const handlers = new Map(options.handlers.map((handler) => [handler.subjectType, handler]))
  if (handlers.size !== options.handlers.length)
    throw new TypeError('Deletion handler subject types must be unique')

  return {
    async undo(deletionIdInput) {
      const deletionId = DeletionIdSchema.parse(deletionIdInput)
      const operation = options.operations.get(deletionId)
      if (operation === undefined)
        throw new DeletionServiceError('DELETION_NOT_FOUND', 'Deletion was not found')
      if (operation.state === 'PURGED')
        throw new DeletionServiceError('DELETION_UNDO_EXPIRED', 'The undo window has expired')
      if (operation.state === 'UNDONE')
        return UndoDeletionResponseSchema.parse({ ...operation, state: 'UNDONE' })

      const handler = handlers.get(operation.subject.type)
      if (handler === undefined)
        throw new DeletionServiceError('DELETION_HANDLER_NOT_FOUND', 'Deletion cannot be restored')
      const result = await handler.undoDeletion(deletionId)
      if (result === 'EXPIRED')
        throw new DeletionServiceError('DELETION_UNDO_EXPIRED', 'The undo window has expired')
      if (result === 'NOT_FOUND')
        throw new DeletionServiceError('DELETION_NOT_FOUND', 'Deletion was not found')
      return UndoDeletionResponseSchema.parse({ ...operation, state: 'UNDONE' })
    },
  }
}
