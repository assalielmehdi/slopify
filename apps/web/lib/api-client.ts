import {
  ApiErrorSchema,
  ConnectorStatusSchema,
  HealthResponseSchema,
  ProjectProfileCatalogResponseSchema,
  ProjectProfileConfigurationSchema,
  ProjectProfileReadinessSchema,
  RevisionIdSchema,
  WorkflowIdSchema,
  type ConnectorStatus,
  type HealthResponse,
  type ProjectProfileCatalogResponse,
  type ProjectProfileConfiguration,
  type ProjectProfileReadiness,
} from '@loop/contracts'
import {
  WorkflowRevisionSchema,
  type AgentNodeConfigurationChanges,
  type WorkflowRevision,
} from '@loop/workflow-model'
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

export interface CreateWorkflowRevisionInput {
  readonly parentRevisionId: string
  readonly revisionId: string
  readonly updates: readonly {
    readonly nodeId: string
    readonly changes: AgentNodeConfigurationChanges
  }[]
}

export interface ApiClient {
  getHealth(): Promise<HealthResponse>
  listProjectProfiles(): Promise<ProjectProfileCatalogResponse>
  createProjectProfile(profile: ProjectProfileConfiguration): Promise<ProjectProfileConfiguration>
  updateProjectProfile(profile: ProjectProfileConfiguration): Promise<ProjectProfileConfiguration>
  getProjectProfileReadiness(profileId: string): Promise<ProjectProfileReadiness>
  getConnectorStatus(): Promise<ConnectorStatus>
  listWorkflows(): Promise<readonly WorkflowCatalogEntry[]>
  getWorkflowRevision(workflowId: string, revisionId: string): Promise<WorkflowRevision>
  createWorkflowRevision(
    workflowId: string,
    input: CreateWorkflowRevisionInput,
  ): Promise<WorkflowRevision>
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

  const request = async <Schema extends z.ZodType>(
    path: string,
    init: RequestInit,
    schema: Schema,
  ): Promise<z.output<Schema>> => {
    const response = await fetchImplementation(path, init)
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

  const get = <Schema extends z.ZodType>(path: string, schema: Schema) =>
    request(path, { headers: { accept: 'application/json' }, method: 'GET' }, schema)

  return {
    async getHealth() {
      return get('/api/healthz', HealthResponseSchema)
    },

    async listProjectProfiles() {
      return get('/api/project-profiles', ProjectProfileCatalogResponseSchema)
    },

    async createProjectProfile(profile) {
      return request(
        '/api/project-profiles',
        {
          body: JSON.stringify(profile),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'POST',
        },
        ProjectProfileConfigurationSchema,
      )
    },

    async updateProjectProfile(profile) {
      return request(
        `/api/project-profiles/${encodeURIComponent(profile.profileId)}`,
        {
          body: JSON.stringify(profile),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'PUT',
        },
        ProjectProfileConfigurationSchema,
      )
    },

    async getProjectProfileReadiness(profileId) {
      return get(
        `/api/project-profiles/${encodeURIComponent(profileId)}/readiness`,
        ProjectProfileReadinessSchema,
      )
    },

    async getConnectorStatus() {
      return get('/api/connectors/status', ConnectorStatusSchema)
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

    async createWorkflowRevision(workflowId, input) {
      return request(
        `/api/workflows/${encodeURIComponent(workflowId)}/revisions`,
        {
          body: JSON.stringify(input),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'POST',
        },
        WorkflowRevisionSchema,
      )
    },
  }
}
