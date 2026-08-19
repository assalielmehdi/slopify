import type { Context } from 'hono'

type ApiApplicationErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503

export class ApiApplicationError extends Error {
  readonly status: ApiApplicationErrorStatus
  readonly code: string
  readonly details?: unknown

  constructor(input: {
    readonly status: ApiApplicationErrorStatus
    readonly code: string
    readonly message: string
    readonly details?: unknown
    readonly cause?: unknown
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'ApiApplicationError'
    this.status = input.status
    this.code = input.code
    if (input.details !== undefined) this.details = input.details
  }
}

export const parseJsonBody = async (context: Context): Promise<unknown> => {
  try {
    return await context.req.json<unknown>()
  } catch (cause) {
    throw new ApiApplicationError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      cause,
    })
  }
}
