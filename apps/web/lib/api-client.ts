import {
  ApiErrorSchema,
  AddProjectRequestSchema,
  DeletionReceiptSchema,
  AgentTraceSchema,
  CancelRunRequestSchema,
  CreateRunRequestSchema,
  HealthResponseSchema,
  HarnessCatalogResponseSchema,
  GitShaSchema,
  NodeIdSchema,
  NodeExecutionStatusSchema,
  OutcomeNameSchema,
  ProjectCatalogResponseSchema,
  ProjectIdSchema,
  ProjectSchema,
  UndoDeletionResponseSchema,
  RunEventSchema,
  RunIdSchema,
  RunPaginationQuerySchema,
  RunStatusSchema,
  WorkflowIdSchema,
  type HealthResponse,
  type HarnessDescriptor,
  type AgentTrace,
  type Project,
  type DeletionReceipt,
  type UndoDeletionResponse,
  type RunStatus,
} from '@slopify/contracts'
import { WorkflowSchema, type Workflow } from '@slopify/workflow-model'
import { z } from 'zod'

const JsonValueSchema = z.json()

const WorkflowCatalogResponseSchema = z.strictObject({
  workflows: z.array(WorkflowSchema).readonly(),
})

const StartRunResponseSchema = z.strictObject({
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  workflowSnapshot: WorkflowSchema,
  variables: z.record(z.string(), JsonValueSchema).readonly(),
  status: RunStatusSchema,
  transitionCount: z.number().int().nonnegative().safe(),
  createdAt: z.iso.datetime({ offset: true }),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
})

const RunHistoryEntrySchema = z.strictObject({
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  status: RunStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  durationMs: z.number().int().nonnegative().safe().nullable(),
})

const RunHistoryPageSchema = z.strictObject({
  data: z.array(RunHistoryEntrySchema).readonly(),
  pagination: z.strictObject({
    page: z.number().int().positive().safe(),
    pageSize: z.number().int().min(1).max(100).safe(),
    totalItems: z.number().int().nonnegative().safe(),
    totalPages: z.number().int().nonnegative().safe(),
  }),
})

const RunProjectSnapshotSchema = z.strictObject({
  projectId: ProjectIdSchema,
  position: z.number().int().nonnegative().safe(),
  name: z.string().trim().min(1),
  repositoryPath: z.string().min(1),
  baseSha: GitShaSchema,
  sourceBranch: z.string().trim().min(1).nullable(),
  isPrimary: z.boolean(),
})

const RunProjectWorktreeSchema = z.strictObject({
  projectId: ProjectIdSchema,
  position: z.number().int().nonnegative().safe(),
  status: z.enum(['PREPARING', 'READY', 'FAILED']),
  worktreePath: z.string().min(1),
  errorMessage: z.string().trim().min(1).max(4_096).nullable(),
  preparedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
})

const RunDetailResponseSchema = z.strictObject({
  run: StartRunResponseSchema,
  events: z.array(RunEventSchema).readonly(),
  nodeExecutions: z
    .array(
      z.strictObject({
        nodeExecutionId: z.string().trim().min(1).max(256),
        attemptId: z.string().trim().min(1).max(256),
        nodeId: NodeIdSchema,
        executionIndex: z.number().int().nonnegative().safe(),
        status: NodeExecutionStatusSchema,
        output: z.json().nullable(),
        outcome: OutcomeNameSchema.nullable(),
        errorCode: z.string().trim().min(1).max(128).nullable(),
        errorMessage: z.string().trim().min(1).max(4_096).nullable(),
        startedAt: z.iso.datetime({ offset: true }).nullable(),
        completedAt: z.iso.datetime({ offset: true }).nullable(),
        durationMs: z.number().int().nonnegative().finite().nullable(),
      }),
    )
    .readonly(),
  projects: z.array(RunProjectSnapshotSchema).readonly(),
  projectWorktrees: z.array(RunProjectWorktreeSchema).readonly(),
})

export type WorkflowCatalogEntry = Workflow
export type JsonValue = z.infer<typeof JsonValueSchema>
export type StartRunResponse = z.infer<typeof StartRunResponseSchema>
export type RunHistoryEntry = z.infer<typeof RunHistoryEntrySchema>
export type RunHistoryPage = z.infer<typeof RunHistoryPageSchema>
export type RunDetailResponse = z.infer<typeof RunDetailResponseSchema>
export interface StartRunInput {
  readonly workflowId: string
  readonly variables?: Readonly<Record<string, JsonValue>>
}

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
  listHarnesses(): Promise<readonly HarnessDescriptor[]>
  listProjects(): Promise<readonly Project[]>
  addProject?(input: { readonly repositoryPath: string }): Promise<Project>
  deleteProject?(projectId: string): Promise<DeletionReceipt>
  undoDeletion?(deletionId: string): Promise<UndoDeletionResponse>
  listWorkflows(): Promise<readonly WorkflowCatalogEntry[]>
  getWorkflow(workflowId: string): Promise<Workflow>
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

    async listHarnesses() {
      return (await get('/api/harnesses', HarnessCatalogResponseSchema)).harnesses
    },

    async listProjects() {
      return (await get('/api/projects', ProjectCatalogResponseSchema)).projects
    },

    async addProject(input) {
      return request(
        '/api/projects',
        {
          body: JSON.stringify(AddProjectRequestSchema.parse(input)),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'POST',
        },
        ProjectSchema,
      )
    },

    async deleteProject(projectId) {
      return request(
        `/api/projects/${encodeURIComponent(projectId)}`,
        { method: 'DELETE', headers: { accept: 'application/json' } },
        DeletionReceiptSchema,
      )
    },

    async undoDeletion(deletionId) {
      return request(
        `/api/deletions/${encodeURIComponent(deletionId)}/undo`,
        { method: 'POST', headers: { accept: 'application/json' } },
        UndoDeletionResponseSchema,
      )
    },

    async listWorkflows() {
      return (await get('/api/workflows', WorkflowCatalogResponseSchema)).workflows
    },

    async getWorkflow(workflowId) {
      return get(`/api/workflows/${encodeURIComponent(workflowId)}`, WorkflowSchema)
    },

    async updateWorkflow(workflowId, workflow) {
      return request(
        `/api/workflows/${encodeURIComponent(WorkflowIdSchema.parse(workflowId))}`,
        {
          body: JSON.stringify(WorkflowSchema.parse(workflow)),
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          method: 'PUT',
        },
        WorkflowSchema,
      )
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
      return get(`/api/runs?${search.toString()}`, RunHistoryPageSchema)
    },

    async getRun(runId) {
      return get(
        `/api/runs/${encodeURIComponent(RunIdSchema.parse(runId))}`,
        RunDetailResponseSchema,
      )
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
