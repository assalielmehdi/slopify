import {
  ApiErrorSchema,
  AddRepositoryRequestSchema,
  AgentTraceSchema,
  CancelRunRequestSchema,
  CreateRunRequestSchema,
  HealthResponseSchema,
  HarnessCatalogResponseSchema,
  ConfigureGitConnectionRequestSchema,
  GitConnectionCatalogResponseSchema,
  GitConnectionSchema,
  GitProviderSchema,
  GitRepositoryCatalogResponseSchema,
  RepositoryCatalogResponseSchema,
  RepositorySchema,
  SettingsSchema,
  UpdateSettingsRequestSchema,
  RunIdSchema,
  RunPaginationQuerySchema,
  WorkflowIdSchema,
  type HealthResponse,
  type HarnessDescriptor,
  type GitConnection,
  type GitProvider,
  type GitRepository,
  type AgentTrace,
  type Repository,
  type Settings,
  type UpdateSettingsRequest,
  type RunStatus,
} from '@slopify/contracts'
import {
  WorkflowFileSchema,
  WorkflowSchema,
  WorkflowSlugSchema,
  workflowFileToWorkflow,
  workflowToWorkflowFile,
  type Workflow,
} from '@slopify/workflow-model'
import { z } from 'zod'

import {
  StartRunResponseSchema,
  normalizeRunHistory,
  parseRunDetail,
  type JsonValue,
  type RunDetailResponse,
  type RunHistoryPage,
  type StartRunResponse,
} from '@/lib/run-api-contract'

export type {
  JsonValue,
  RunDetailResponse,
  RunHistoryEntry,
  RunHistoryPage,
  StartRunResponse,
} from '@/lib/run-api-contract'

const SettingsEtagSchema = z.string().regex(/^"(?:missing|[a-f0-9]{64})"$/)
const WorkflowRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const WorkflowEtagSchema = z.string().regex(/^"(?:missing|[a-f0-9]{64})"$/u)

const WorkflowDiagnosticSchema = z.strictObject({
  code: z.enum([
    'WORKFLOW_DIRECTORY_INVALID',
    'WORKFLOW_FILE_MISSING',
    'WORKFLOW_FILE_MALFORMED',
    'WORKFLOW_FILE_INVALID',
    'WORKFLOW_ID_MISMATCH',
    'WORKFLOW_GRAPH_INVALID',
    'WORKFLOW_ENTRY_UNAVAILABLE',
  ]),
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).readonly(),
})

const WorkflowReadinessFindingSchema = z.strictObject({
  code: z.enum([
    'WORKFLOW_EMPTY_GRAPH',
    'HARNESS_NOT_FOUND',
    'HARNESS_UNAVAILABLE',
    'HARNESS_MODEL_UNAVAILABLE',
    'HARNESS_THINKING_UNAVAILABLE',
  ]),
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).readonly(),
})

const ValidWorkflowCatalogEntrySchema = z.strictObject({
  status: z.literal('VALID'),
  workflowId: WorkflowSlugSchema,
  value: WorkflowFileSchema,
  revision: WorkflowRevisionSchema,
  runnable: z.boolean(),
  readiness: z.array(WorkflowReadinessFindingSchema).readonly(),
})

const InvalidWorkflowCatalogEntrySchema = z.strictObject({
  status: z.literal('INVALID'),
  workflowId: z.string().min(1),
  revision: WorkflowRevisionSchema.nullable(),
  diagnostics: z.array(WorkflowDiagnosticSchema).readonly(),
})

const WorkflowCatalogEntrySchema = z.discriminatedUnion('status', [
  ValidWorkflowCatalogEntrySchema,
  InvalidWorkflowCatalogEntrySchema,
])

const WorkflowCatalogResponseSchema = z.strictObject({
  workflows: z.array(WorkflowCatalogEntrySchema).readonly(),
})

const CreateWorkflowDefinitionInputSchema = z.strictObject({
  workflowId: WorkflowSlugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(4096),
})

export type WorkflowCatalogEntry = Workflow
export interface StartRunInput {
  readonly workflowId: string
  readonly variables?: Readonly<Record<string, JsonValue>>
}

export interface SettingsSnapshot {
  readonly value: Settings
  readonly etag: string
}

export type CreateWorkflowDefinitionInput = z.infer<typeof CreateWorkflowDefinitionInputSchema>

export interface ListRunsInput {
  readonly page: number
  readonly pageSize: number
  readonly runId?: string
  readonly statuses?: readonly RunStatus[]
  readonly startedFrom?: string
  readonly startedTo?: string
  readonly durationMinMs?: number
  readonly durationMaxMs?: number
}

export interface ApiClient {
  getHealth(): Promise<HealthResponse>
  getSettings(): Promise<SettingsSnapshot>
  updateSettings(input: UpdateSettingsRequest, etag: string): Promise<SettingsSnapshot>
  listGitConnections(): Promise<readonly GitConnection[]>
  configureGitConnection(
    provider: GitProvider,
    input: { readonly token: string },
  ): Promise<GitConnection>
  disconnectGitConnection(provider: GitProvider): Promise<void>
  listGitRepositories(provider: GitProvider): Promise<readonly GitRepository[]>
  listHarnesses(): Promise<readonly HarnessDescriptor[]>
  listRepositories(): Promise<readonly Repository[]>
  addRepository(input: {
    readonly provider: GitProvider
    readonly remoteId: string
  }): Promise<Repository>
  deleteRepository(repositoryId: string): Promise<void>
  listWorkflows(): Promise<readonly WorkflowCatalogEntry[]>
  createWorkflow(input: CreateWorkflowDefinitionInput): Promise<Workflow>
  deleteWorkflow(workflowId: string): Promise<void>
  getWorkflow(
    workflowId: string,
    options?: { readonly preserveRevision?: boolean },
  ): Promise<Workflow>
  updateWorkflow(workflowId: string, workflow: Workflow): Promise<Workflow>
  startRun(input: StartRunInput): Promise<StartRunResponse>
  listRuns(input: ListRunsInput): Promise<RunHistoryPage>
  getRun(runId: string): Promise<RunDetailResponse>
  getAgentTrace(runId: string, nodeExecutionId: string, attemptId: string): Promise<AgentTrace>
  cancelRun(runId: string, input?: { readonly reason?: string }): Promise<StartRunResponse>
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
  const workflowEtags = new Map<string, string>()

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

  const requestSettings = async (init: RequestInit): Promise<SettingsSnapshot> => {
    const response = await fetchImplementation('/api/settings', init)
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

    return {
      value: SettingsSchema.parse(body),
      etag: SettingsEtagSchema.parse(response.headers.get('etag')),
    }
  }

  const requestEmpty = async (path: string, init: RequestInit): Promise<void> => {
    const response = await fetchImplementation(path, init)
    if (response.ok) return
    const apiError = ApiErrorSchema.parse(await response.json()).error
    throw new ApiClientError({
      code: apiError.code,
      message: apiError.message,
      status: response.status,
      ...(apiError.details === undefined ? {} : { details: apiError.details }),
    })
  }

  const validWorkflow = (
    entry: z.infer<typeof WorkflowCatalogEntrySchema>,
    etag?: string,
    preserveRevision = false,
  ): Workflow => {
    if (entry.status === 'INVALID') {
      throw new ApiClientError({
        code: 'WORKFLOW_FILE_INVALID',
        message: entry.diagnostics[0]?.message ?? 'Workflow definition is invalid',
        status: 409,
        details: { diagnostics: entry.diagnostics },
      })
    }
    if (!preserveRevision) workflowEtags.set(entry.workflowId, etag ?? `"${entry.revision}"`)
    return workflowFileToWorkflow(entry.value)
  }

  const requestWorkflow = async (
    path: string,
    init: RequestInit,
    preserveRevision = false,
  ): Promise<Workflow> => {
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
    const entry = WorkflowCatalogEntrySchema.parse(body)
    return validWorkflow(
      entry,
      WorkflowEtagSchema.parse(response.headers.get('etag')),
      preserveRevision,
    )
  }

  return {
    async getHealth() {
      return get('/api/healthz', HealthResponseSchema)
    },

    async getSettings() {
      return requestSettings({ headers: { accept: 'application/json' }, method: 'GET' })
    },

    async updateSettings(input, etag) {
      return requestSettings({
        body: JSON.stringify(UpdateSettingsRequestSchema.parse(input)),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'if-match': SettingsEtagSchema.parse(etag),
        },
        method: 'PATCH',
      })
    },

    async listGitConnections() {
      return (await get('/api/git/connections', GitConnectionCatalogResponseSchema)).connections
    },

    async configureGitConnection(providerInput, input) {
      const provider = GitProviderSchema.parse(providerInput)
      return request(
        `/api/git/connections/${provider}`,
        {
          body: JSON.stringify(ConfigureGitConnectionRequestSchema.parse(input)),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'PUT',
        },
        GitConnectionSchema,
      )
    },

    async disconnectGitConnection(providerInput) {
      const provider = GitProviderSchema.parse(providerInput)
      return requestEmpty(`/api/git/connections/${provider}`, {
        headers: { accept: 'application/json' },
        method: 'DELETE',
      })
    },

    async listGitRepositories(providerInput) {
      const provider = GitProviderSchema.parse(providerInput)
      return (
        await get(
          `/api/git/connections/${provider}/repositories`,
          GitRepositoryCatalogResponseSchema,
        )
      ).repositories
    },

    async listHarnesses() {
      return (await get('/api/harnesses', HarnessCatalogResponseSchema)).harnesses
    },

    async listRepositories() {
      return (await get('/api/repositories', RepositoryCatalogResponseSchema)).repositories
    },

    async addRepository(input) {
      return request(
        '/api/repositories',
        {
          body: JSON.stringify(AddRepositoryRequestSchema.parse(input)),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'POST',
        },
        RepositorySchema,
      )
    },

    async deleteRepository(repositoryId) {
      return requestEmpty(`/api/repositories/${encodeURIComponent(repositoryId)}`, {
        method: 'DELETE',
        headers: { accept: 'application/json' },
      })
    },

    async listWorkflows() {
      const { workflows } = await get('/api/workflows', WorkflowCatalogResponseSchema)
      return workflows.flatMap((entry) => (entry.status === 'VALID' ? [validWorkflow(entry)] : []))
    },

    async createWorkflow(input) {
      const parsed = CreateWorkflowDefinitionInputSchema.parse(input)
      return requestWorkflow('/api/workflows', {
        body: JSON.stringify(parsed),
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        method: 'POST',
      })
    },

    async deleteWorkflow(workflowId) {
      return requestEmpty(
        `/api/workflows/${encodeURIComponent(WorkflowIdSchema.parse(workflowId))}`,
        { headers: { accept: 'application/json' }, method: 'DELETE' },
      )
    },

    async getWorkflow(workflowId, options) {
      const parsedId = WorkflowSlugSchema.parse(workflowId)
      return requestWorkflow(
        `/api/workflows/${encodeURIComponent(parsedId)}`,
        {
          headers: { accept: 'application/json' },
          method: 'GET',
        },
        options?.preserveRevision ?? false,
      )
    },

    async updateWorkflow(workflowId, workflow) {
      const parsedId = WorkflowSlugSchema.parse(workflowId)
      const expectedEtag = workflowEtags.get(parsedId)
      if (expectedEtag === undefined) {
        throw new ApiClientError({
          code: 'WORKFLOW_PRECONDITION_REQUIRED',
          message: 'Reload the workflow before saving changes',
          status: 428,
        })
      }
      return requestWorkflow(`/api/workflows/${encodeURIComponent(parsedId)}`, {
        body: JSON.stringify(workflowToWorkflowFile(WorkflowSchema.parse(workflow))),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'if-match': WorkflowEtagSchema.parse(expectedEtag),
        },
        method: 'PUT',
      })
    },

    async startRun(input) {
      return request(
        '/api/runs',
        {
          body: JSON.stringify(CreateRunRequestSchema.parse(input)),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'POST',
        },
        StartRunResponseSchema,
      )
    },

    async listRuns(input) {
      const query = RunPaginationQuerySchema.parse({
        ...input,
        ...(input.statuses === undefined ? {} : { statuses: [...input.statuses] }),
      })
      const search = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      })
      if (query.runId !== undefined) search.set('runId', query.runId)
      for (const status of query.statuses ?? []) search.append('status', status)
      if (query.startedFrom !== undefined) search.set('startedFrom', query.startedFrom)
      if (query.startedTo !== undefined) search.set('startedTo', query.startedTo)
      if (query.durationMinMs !== undefined)
        search.set('durationMinMs', String(query.durationMinMs))
      if (query.durationMaxMs !== undefined)
        search.set('durationMaxMs', String(query.durationMaxMs))
      const response = await fetchImplementation(`/api/runs?${search.toString()}`, {
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
      return normalizeRunHistory(body)
    },

    async getRun(runId) {
      const response = await fetchImplementation(
        `/api/runs/${encodeURIComponent(RunIdSchema.parse(runId))}`,
        { headers: { accept: 'application/json' }, method: 'GET' },
      )
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
      const detail = parseRunDetail(body)
      if (detail.status === 'CORRUPT') {
        throw new ApiClientError({
          code: 'RUN_CORRUPT',
          message: detail.diagnostic.message,
          status: 409,
          details: detail.diagnostic,
        })
      }
      return detail.value
    },

    async getAgentTrace(runId, nodeExecutionId, attemptId) {
      const search = new URLSearchParams({ attemptId })
      return get(
        `/api/runs/${encodeURIComponent(RunIdSchema.parse(runId))}/node-executions/${encodeURIComponent(nodeExecutionId)}/trace?${search.toString()}`,
        AgentTraceSchema,
      )
    },

    async cancelRun(runId, input = {}) {
      return request(
        `/api/runs/${encodeURIComponent(RunIdSchema.parse(runId))}/cancel`,
        {
          body: JSON.stringify(CancelRunRequestSchema.parse(input)),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'POST',
        },
        StartRunResponseSchema,
      )
    },
  }
}
