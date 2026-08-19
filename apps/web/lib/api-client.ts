import { ApiErrorSchema, HealthResponseSchema, type HealthResponse } from '@loop/contracts'

export interface ApiClient {
  getHealth(): Promise<HealthResponse>
}

export class ApiClientError extends Error {
  override readonly name = 'ApiClientError'
  readonly code: string
  readonly status: number
  readonly details: unknown

  constructor(input: {
    readonly code: string
    readonly message: string
    readonly status: number
    readonly details?: unknown
  }) {
    super(input.message)
    this.code = input.code
    this.status = input.status
    this.details = input.details
  }
}

export const createApiClient = (
  options: Readonly<{ fetch?: typeof globalThis.fetch }> = {},
): ApiClient => {
  const fetchImplementation = options.fetch ?? globalThis.fetch

  return {
    async getHealth() {
      const response = await fetchImplementation('/api/healthz', {
        headers: { accept: 'application/json' },
        method: 'GET',
      })
      const body: unknown = await response.json()

      if (!response.ok) {
        const apiError = ApiErrorSchema.parse(body).error
        throw new ApiClientError({
          code: apiError.code,
          message: apiError.message,
          status: response.status,
          ...(apiError.details === undefined ? {} : { details: apiError.details }),
        })
      }

      return HealthResponseSchema.parse(body)
    },
  }
}
