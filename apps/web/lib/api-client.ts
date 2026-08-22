import {
  ApiErrorSchema,
  AddProjectRequestSchema,
  ArtifactIdSchema,
  ArtifactTypeSchema,
  CancelRunRequestSchema,
  ConnectionCatalogEntrySchema,
  ConnectorStatusSchema,
  CreateRunRequestSchema,
  HealthResponseSchema,
  NodeIdSchema,
  NodeExecutionStatusSchema,
  OutcomeNameSchema,
  ProjectCatalogResponseSchema,
  ProjectSchema,
  RepositoryIdSchema,
  RunEventSchema,
  RunIdSchema,
  RunPaginationQuerySchema,
  RunStatusSchema,
  WorkflowIdSchema,
  type ConnectorStatus,
  type ConnectionCatalogEntry,
  type HealthResponse,
  type Project,
} from '@loop/contracts'
import { WorkflowSchema, type Workflow } from '@loop/workflow-model'
import { z } from 'zod'

const JsonValueSchema = z.json()

const WorkflowCatalogResponseSchema = z.strictObject({
  workflows: z.array(WorkflowSchema).readonly(),
})

const SkillFileSchema = z.strictObject({
  path: z.string().min(1),
  content: z.string(),
  size: z.number().int().nonnegative(),
})
const SkillRecordSchema = z.strictObject({
  skillId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  digest: z.string().length(64),
  modifiedAt: z.iso.datetime({ offset: true }),
  valid: z.boolean(),
  issues: z.array(z.string()).readonly(),
  files: z.array(SkillFileSchema).readonly(),
})
const SkillsResponseSchema = z.strictObject({ skills: z.array(SkillRecordSchema).readonly() })

const ConnectionRecordSchema = z.strictObject({
  connectionId: z.string().min(1),
  type: z.enum(['gitlab', 'clickup', 'openrouter', 'chatgpt-subscription']),
  category: z.enum(['connector', 'inference']),
  label: z.string().min(1),
  authority: z.string().min(1),
  configuration: z.unknown(),
  metadata: z.unknown(),
  status: z.enum(['CONNECTED', 'INVALID']),
  validatedAt: z.iso.datetime({ offset: true }),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})
const ConnectionsResponseSchema = z.strictObject({
  catalog: z.array(ConnectionCatalogEntrySchema).readonly(),
  connections: z.array(ConnectionRecordSchema).readonly(),
})
const ChatGptOAuthTransactionSchema = z.discriminatedUnion('status', [
  z.strictObject({
    id: z.string(),
    status: z.literal('PENDING'),
    authorizationUrl: z.url().optional(),
    instructions: z.string().optional(),
  }),
  z.strictObject({
    id: z.string(),
    status: z.literal('CONNECTED'),
    connectionId: z.string(),
  }),
  z.strictObject({ id: z.string(), status: z.literal('FAILED'), message: z.string() }),
  z.strictObject({ id: z.string(), status: z.literal('CANCELLED') }),
])

const StartRunResponseSchema = z.strictObject({
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  workflowSnapshot: WorkflowSchema,
  variables: z.record(z.string(), JsonValueSchema).readonly(),
  missingVariables: z.array(z.string().trim().min(1).max(128)).readonly(),
  status: RunStatusSchema,
  currentNodeId: NodeIdSchema.nullable(),
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

const RunDetailResponseSchema = z.strictObject({
  run: StartRunResponseSchema,
  events: z.array(RunEventSchema).readonly(),
  nodeExecutions: z
    .array(
      z.strictObject({
        nodeExecutionId: z.string().trim().min(1).max(256),
        attemptId: z.string().trim().min(1).max(256).nullable().default(null),
        nodeId: NodeIdSchema,
        executionIndex: z.number().int().nonnegative().safe(),
        status: NodeExecutionStatusSchema,
        inputReferences: z.json(),
        output: z.json().nullable(),
        outcome: OutcomeNameSchema.nullable(),
        errorCode: z.string().trim().min(1).max(128).nullable(),
        errorMessage: z.string().trim().min(1).max(4_096).nullable(),
        selectedTargetNodeId: NodeIdSchema.nullable(),
        startedAt: z.iso.datetime({ offset: true }).nullable(),
        completedAt: z.iso.datetime({ offset: true }).nullable(),
        durationMs: z.number().int().nonnegative().finite().nullable(),
      }),
    )
    .readonly(),
  outputChunks: z
    .array(
      z.strictObject({
        sequence: z.number().int().positive().safe(),
        eventSequence: z.number().int().positive().safe(),
        nodeExecutionId: z.string().trim().min(1).max(256),
        channel: z.enum(['stdout', 'stderr', 'agent']),
        repositoryId: RepositoryIdSchema.nullable(),
        content: z.string().max(65_536),
        createdAt: z.iso.datetime({ offset: true }),
      }),
    )
    .readonly(),
  artifacts: z
    .array(
      z.strictObject({
        artifactId: ArtifactIdSchema,
        nodeExecutionId: z.string().trim().min(1).max(256),
        artifactType: ArtifactTypeSchema,
        content: z.string(),
        metadata: z.json(),
        createdAt: z.iso.datetime({ offset: true }),
      }),
    )
    .readonly(),
})

export type WorkflowCatalogEntry = Workflow
export type JsonValue = z.infer<typeof JsonValueSchema>
export type StartRunResponse = z.infer<typeof StartRunResponseSchema>
export type RunHistoryEntry = z.infer<typeof RunHistoryEntrySchema>
export type RunHistoryPage = z.infer<typeof RunHistoryPageSchema>
export type RunDetailResponse = z.infer<typeof RunDetailResponseSchema>
export type SkillRecord = z.infer<typeof SkillRecordSchema>
export type ConnectionRecord = z.infer<typeof ConnectionRecordSchema>
export type ConnectionCatalogResponse = Readonly<{
  catalog: readonly ConnectionCatalogEntry[]
  connections: readonly ConnectionRecord[]
}>
export type ChatGptOAuthTransaction = z.infer<typeof ChatGptOAuthTransactionSchema>

export interface StartRunInput {
  readonly workflowId: string
  readonly variables?: Readonly<Record<string, JsonValue>>
  readonly confirmMissingVariables?: boolean
}

export interface ApiClient {
  getHealth(): Promise<HealthResponse>
  listProjects?(): Promise<readonly Project[]>
  addProject?(input: { readonly repositoryPath: string }): Promise<Project>
  deleteProject?(projectId: string): Promise<void>
  getConnectorStatus(): Promise<ConnectorStatus>
  listWorkflows(): Promise<readonly WorkflowCatalogEntry[]>
  getWorkflow(workflowId: string): Promise<Workflow>
  startRun(input: StartRunInput): Promise<StartRunResponse>
  listRuns(input: { readonly page: number; readonly pageSize: number }): Promise<RunHistoryPage>
  getRun(runId: string): Promise<RunDetailResponse>
  cancelRun(runId: string, input?: { readonly reason?: string }): Promise<StartRunResponse>
  listSkills?(): Promise<readonly SkillRecord[]>
  getSkill?(skillId: string): Promise<SkillRecord>
  createSkill?(
    input: Readonly<{
      skillId: string
      name: string
      description: string
      instructions: string
    }>,
  ): Promise<SkillRecord>
  updateSkill?(
    skillId: string,
    input: Readonly<{ expectedDigest: string; files: Readonly<Record<string, string>> }>,
  ): Promise<SkillRecord>
  deleteSkill?(skillId: string, expectedDigest: string): Promise<void>
  listConnections?(): Promise<ConnectionCatalogResponse>
  connect?(
    input: Readonly<{
      connectionId?: string
      type: 'gitlab' | 'clickup' | 'openrouter'
      label: string
      configuration: unknown
      credential: Readonly<{ type: 'api_key'; key: string }>
    }>,
  ): Promise<ConnectionRecord>
  revalidateConnection?(connectionId: string): Promise<ConnectionRecord>
  replaceConnectionCredential?(connectionId: string, key: string): Promise<ConnectionRecord>
  deleteConnection?(connectionId: string): Promise<void>
  startChatGptOAuth?(label: string): Promise<ChatGptOAuthTransaction>
  getChatGptOAuth?(transactionId: string): Promise<ChatGptOAuthTransaction>
  cancelChatGptOAuth?(transactionId: string): Promise<void>
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

  const noContent = async (path: string, init: RequestInit): Promise<void> => {
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

  return {
    async getHealth() {
      return get('/api/healthz', HealthResponseSchema)
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
      return noContent(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' })
    },

    async getConnectorStatus() {
      return get('/api/connectors/status', ConnectorStatusSchema)
    },

    async listWorkflows() {
      return (await get('/api/workflows', WorkflowCatalogResponseSchema)).workflows
    },

    async getWorkflow(workflowId) {
      return get(`/api/workflows/${encodeURIComponent(workflowId)}`, WorkflowSchema)
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
      const query = RunPaginationQuerySchema.parse(input)
      const search = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      })
      return get(`/api/runs?${search.toString()}`, RunHistoryPageSchema)
    },

    async getRun(runId) {
      return get(
        `/api/runs/${encodeURIComponent(RunIdSchema.parse(runId))}`,
        RunDetailResponseSchema,
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

    async listSkills() {
      return (await get('/api/skills', SkillsResponseSchema)).skills
    },
    async getSkill(skillId) {
      return get(`/api/skills/${encodeURIComponent(skillId)}`, SkillRecordSchema)
    },
    async createSkill(input) {
      return request(
        '/api/skills',
        {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        SkillRecordSchema,
      )
    },
    async updateSkill(skillId, input) {
      return request(
        `/api/skills/${encodeURIComponent(skillId)}`,
        {
          method: 'PUT',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        SkillRecordSchema,
      )
    },
    async deleteSkill(skillId, expectedDigest) {
      return noContent(`/api/skills/${encodeURIComponent(skillId)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedDigest }),
      })
    },
    async listConnections() {
      return get('/api/connections', ConnectionsResponseSchema)
    },
    async connect(input) {
      return request(
        '/api/connections',
        {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        ConnectionRecordSchema,
      )
    },
    async revalidateConnection(connectionId) {
      return request(
        `/api/connections/${encodeURIComponent(connectionId)}/revalidate`,
        { method: 'POST', headers: { accept: 'application/json' } },
        ConnectionRecordSchema,
      )
    },
    async replaceConnectionCredential(connectionId, key) {
      return request(
        `/api/connections/${encodeURIComponent(connectionId)}/credential`,
        {
          method: 'PUT',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ credential: { type: 'api_key', key } }),
        },
        ConnectionRecordSchema,
      )
    },
    async deleteConnection(connectionId) {
      return noContent(`/api/connections/${encodeURIComponent(connectionId)}`, {
        method: 'DELETE',
      })
    },
    async startChatGptOAuth(label) {
      return request(
        '/api/connections/chatgpt/oauth',
        {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ label }),
        },
        ChatGptOAuthTransactionSchema,
      )
    },
    async getChatGptOAuth(transactionId) {
      return get(
        `/api/connections/chatgpt/oauth/${encodeURIComponent(transactionId)}`,
        ChatGptOAuthTransactionSchema,
      )
    },
    async cancelChatGptOAuth(transactionId) {
      return noContent(`/api/connections/chatgpt/oauth/${encodeURIComponent(transactionId)}`, {
        method: 'DELETE',
      })
    },
  }
}
