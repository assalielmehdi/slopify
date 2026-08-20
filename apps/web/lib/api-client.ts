import {
  ApiErrorSchema,
  HealthResponseSchema,
  RevisionIdSchema,
  WorkflowIdSchema,
  type HealthResponse,
} from '@loop/contracts'
import { WorkflowRevisionSchema, type WorkflowRevision } from '@loop/workflow-model'
import { z } from 'zod'

const WorkflowRevisionSummarySchema = z.strictObject({
  revisionId: RevisionIdSchema,
  parentRevisionId: RevisionIdSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})

const WorkflowCatalogEntrySchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  name: z.string().trim().min(1),
  latestRevisionId: RevisionIdSchema,
  revisions: z.array(WorkflowRevisionSummarySchema).min(1).readonly(),
})

const WorkflowCatalogResponseSchema = z.strictObject({
  workflows: z.array(WorkflowCatalogEntrySchema).readonly(),
})

export type WorkflowCatalogEntry = z.infer<typeof WorkflowCatalogEntrySchema>

export interface ApiClient {
  getHealth(): Promise<HealthResponse>
  listWorkflows(): Promise<readonly WorkflowCatalogEntry[]>
  getWorkflowRevision(workflowId: string, revisionId: string): Promise<WorkflowRevision>
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

  const get = async <Schema extends z.ZodType>(
    path: string,
    schema: Schema,
  ): Promise<z.output<Schema>> => {
    const response = await fetchImplementation(path, {
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

    return schema.parse(body)
  }

  return {
    async getHealth() {
      return get('/api/healthz', HealthResponseSchema)
    },

    async listWorkflows() {
      return (await get('/api/workflows', WorkflowCatalogResponseSchema)).workflows
    },

    async getWorkflowRevision(workflowId, revisionId) {
      return get(
        `/api/workflows/${encodeURIComponent(workflowId)}/revisions/${encodeURIComponent(revisionId)}`,
        WorkflowRevisionSchema,
      )
    },
  }
}
