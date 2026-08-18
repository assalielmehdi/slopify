export type PersistenceErrorCode =
  | 'PERSISTENCE_CONFLICT'
  | 'PERSISTENCE_NOT_FOUND'
  | 'PERSISTENCE_VALIDATION_FAILED'
  | 'PERSISTENCE_WRITE_FAILED'
  | 'PERSISTENCE_READ_FAILED'

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode
  readonly details?: Readonly<Record<string, unknown>>

  constructor(input: {
    readonly code: PersistenceErrorCode
    readonly message: string
    readonly details?: Readonly<Record<string, unknown>>
    readonly cause?: unknown
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'PersistenceError'
    this.code = input.code
    if (input.details !== undefined) this.details = input.details
  }
}

export const mapPersistenceError = (cause: unknown, message: string): PersistenceError => {
  if (cause instanceof PersistenceError) return cause
  return new PersistenceError({ code: 'PERSISTENCE_WRITE_FAILED', message, cause })
}
