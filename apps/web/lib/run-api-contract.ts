import {
  GitProviderSchema,
  GitShaSchema,
  NodeExecutionStatusSchema,
  NodeIdSchema,
  RepositoryIdSchema,
  RunIdSchema,
  RunStatusSchema,
  WorkflowIdSchema,
} from '@slopify/contracts'
import { WorkflowFileSchema, WorkflowSchema, workflowFileToWorkflow } from '@slopify/workflow-model'
import { z } from 'zod'

const JsonValueSchema = z.json()
const WorkflowRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/u)

const RunProjectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  status: RunStatusSchema,
  transitionCount: z.number().int().nonnegative().safe(),
  lastEventSequence: z.number().int().nonnegative().safe(),
  createdAt: z.iso.datetime({ offset: true }),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  failureCode: z.string().trim().min(1).max(128).nullable(),
})

export const StartRunResponseSchema = RunProjectionSchema

const RunDiagnosticSchema = z.strictObject({ code: z.string().min(1), message: z.string().min(1) })
const RunHistoryEntrySchema = z.strictObject({
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  status: z.union([RunStatusSchema, z.literal('CORRUPT')]),
  createdAt: z.iso.datetime({ offset: true }).nullable(),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  durationMs: z.number().int().nonnegative().safe().nullable(),
  diagnostic: RunDiagnosticSchema.optional(),
})

const PaginationSchema = z.strictObject({
  page: z.number().int().positive().safe(),
  pageSize: z.number().int().min(1).max(100).safe(),
  totalItems: z.number().int().nonnegative().safe(),
  totalPages: z.number().int().nonnegative().safe(),
})

const FilesystemRunIndexEntrySchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('READY'),
    locator: z.strictObject({ workflowId: WorkflowIdSchema, runId: RunIdSchema }),
    run: RunProjectionSchema,
  }),
  z.strictObject({
    status: z.literal('CORRUPT'),
    locator: z.strictObject({ workflowId: WorkflowIdSchema, runId: RunIdSchema }),
    diagnostic: RunDiagnosticSchema,
  }),
])

const FilesystemRunIndexPageSchema = z.strictObject({
  data: z.array(FilesystemRunIndexEntrySchema).readonly(),
  pagination: PaginationSchema,
})

export const RunHistoryPageSchema = z.strictObject({
  data: z.array(RunHistoryEntrySchema).readonly(),
  pagination: PaginationSchema,
})

const RunRepositorySnapshotSchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  position: z.number().int().nonnegative().safe(),
  name: z.string().trim().min(1),
  provider: GitProviderSchema,
  remoteId: z.string().trim().min(1),
  fullName: z.string().trim().min(1),
  cloneUrl: z.string().trim().min(1),
  defaultBranch: z.string().trim().min(1),
  baseSha: GitShaSchema,
  isPrimary: z.boolean(),
})

const RunRepositoryWorkspaceSchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  position: z.number().int().nonnegative().safe(),
  status: z.enum(['PREPARING', 'READY', 'FAILED', 'CLEANED']),
  workspacePath: z.string().min(1),
  branchName: z.string().trim().min(1),
  errorMessage: z.string().trim().min(1).max(4_096).nullable(),
  preparedAt: z.iso.datetime({ offset: true }).nullable(),
  cleanedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
})

const RunRepositoryArtifactSchema = RunRepositorySnapshotSchema.extend({
  webUrl: z.url({ protocol: /^https$/u }),
})

const RunDomainEventBase = {
  schemaVersion: z.literal(1),
  eventId: z.string().trim().min(1).max(128),
  runId: RunIdSchema,
  sequence: z.number().int().positive().safe(),
  timestamp: z.iso.datetime({ offset: true }),
} as const
const runDomainEvent = <Type extends string, Data extends z.ZodType>(type: Type, data: Data) =>
  z.strictObject({ ...RunDomainEventBase, type: z.literal(type), data })
const executionIdentifier = z.string().trim().min(1).max(128)
const runErrorCode = z.string().trim().min(1).max(128)
const runMessage = z.string().trim().min(1).max(4_096)
const runDuration = z.number().int().nonnegative().safe()

export const ApiRunEventSchema = z.discriminatedUnion('type', [
  runDomainEvent('RUN_STARTED', z.strictObject({})),
  runDomainEvent('RUN_CANCEL_REQUESTED', z.strictObject({ reason: z.string().min(1).max(1_024) })),
  runDomainEvent('RUN_SUCCEEDED', z.strictObject({})),
  runDomainEvent('RUN_FAILED', z.strictObject({ code: runErrorCode })),
  runDomainEvent('RUN_CANCELLED', z.strictObject({})),
  runDomainEvent(
    'WORKSPACE_PREPARING',
    z.strictObject({
      repositoryId: RepositoryIdSchema,
      position: z.number().int().nonnegative().safe(),
      workspacePath: z.string().trim().min(1),
      branchName: z.string().trim().min(1),
    }),
  ),
  runDomainEvent('WORKSPACE_READY', z.strictObject({ repositoryId: RepositoryIdSchema })),
  runDomainEvent(
    'WORKSPACE_FAILED',
    z.strictObject({ repositoryId: RepositoryIdSchema, errorMessage: runMessage }),
  ),
  runDomainEvent('WORKSPACE_CLEANED', z.strictObject({ repositoryId: RepositoryIdSchema })),
  runDomainEvent(
    'NODE_SCHEDULED',
    z.strictObject({
      nodeExecutionId: executionIdentifier,
      attemptId: executionIdentifier,
      nodeId: NodeIdSchema,
      executionIndex: z.number().int().nonnegative().safe(),
      causationId: executionIdentifier,
    }),
  ),
  runDomainEvent(
    'NODE_STARTED',
    z.strictObject({ nodeExecutionId: executionIdentifier, attemptId: executionIdentifier }),
  ),
  runDomainEvent(
    'NODE_SUCCEEDED',
    z.strictObject({
      nodeExecutionId: executionIdentifier,
      attemptId: executionIdentifier,
      outcome: z.string().trim().min(1).max(128),
      output: z.json(),
      durationMs: runDuration,
    }),
  ),
  runDomainEvent(
    'NODE_FAILED',
    z.strictObject({
      nodeExecutionId: executionIdentifier,
      attemptId: executionIdentifier,
      code: runErrorCode,
      message: runMessage,
      durationMs: runDuration,
    }),
  ),
  runDomainEvent(
    'NODE_CANCELLED',
    z.strictObject({
      nodeExecutionId: executionIdentifier,
      attemptId: executionIdentifier,
      reason: z.string().trim().min(1).max(1_024),
      durationMs: runDuration,
    }),
  ),
  runDomainEvent(
    'NODE_TERMINATION_UNCONFIRMED',
    z.strictObject({
      nodeExecutionId: executionIdentifier,
      attemptId: executionIdentifier,
      reason: z.string().trim().min(1).max(1_024),
    }),
  ),
  runDomainEvent(
    'ROUTE_TRAVERSED',
    z.strictObject({
      sourceNodeExecutionId: executionIdentifier,
      sourceNodeId: NodeIdSchema,
      targetNodeId: NodeIdSchema,
      outcome: z.string().trim().min(1).max(128),
    }),
  ),
  runDomainEvent(
    'JOIN_RELEASED',
    z.strictObject({ targetNodeId: NodeIdSchema, causationId: executionIdentifier }),
  ),
])

export type ApiRunEvent = z.infer<typeof ApiRunEventSchema>

const FilesystemNodeExecutionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  nodeExecutionId: executionIdentifier,
  attemptId: executionIdentifier,
  nodeId: NodeIdSchema,
  executionIndex: z.number().int().nonnegative().safe(),
  status: NodeExecutionStatusSchema,
  lastEventSequence: z.number().int().nonnegative().safe(),
  output: z.json().nullable(),
  outcome: z.string().trim().min(1).max(128).nullable(),
  errorCode: runErrorCode.nullable(),
  errorMessage: runMessage.nullable(),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  durationMs: runDuration.nullable(),
})

const RunNodeExecutionSchema = FilesystemNodeExecutionSchema.omit({
  schemaVersion: true,
  runId: true,
  lastEventSequence: true,
})

const FilesystemRunDetailSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('READY'),
    run: RunProjectionSchema,
    workflowSnapshot: z.strictObject({
      schemaVersion: z.literal(1),
      capturedAt: z.iso.datetime({ offset: true }),
      workflowRevision: WorkflowRevisionSchema,
      workflow: WorkflowFileSchema,
    }),
    variablesSnapshot: z.strictObject({
      schemaVersion: z.literal(1),
      values: z.record(z.string(), JsonValueSchema).readonly(),
    }),
    repositoriesSnapshot: z.strictObject({
      schemaVersion: z.literal(1),
      repositories: z.array(RunRepositoryArtifactSchema).readonly(),
    }),
    workspaces: z.strictObject({
      schemaVersion: z.literal(1),
      runId: RunIdSchema,
      lastEventSequence: z.number().int().nonnegative().safe(),
      workspaces: z.array(RunRepositoryWorkspaceSchema).readonly(),
    }),
    executions: z.array(FilesystemNodeExecutionSchema).readonly(),
    events: z.array(ApiRunEventSchema).readonly(),
  }),
  z.strictObject({
    status: z.literal('CORRUPT'),
    locator: z.strictObject({ workflowId: WorkflowIdSchema, runId: RunIdSchema }),
    diagnostic: RunDiagnosticSchema,
  }),
])

const NormalizedRunSchema = RunProjectionSchema.extend({
  workflowSnapshot: WorkflowSchema,
  variables: z.record(z.string(), JsonValueSchema).readonly(),
})

export const RunDetailResponseSchema = z.strictObject({
  run: NormalizedRunSchema,
  events: z.array(ApiRunEventSchema).readonly(),
  nodeExecutions: z.array(RunNodeExecutionSchema).readonly(),
  repositories: z.array(RunRepositorySnapshotSchema).readonly(),
  repositoryWorkspaces: z.array(RunRepositoryWorkspaceSchema).readonly(),
})

export type JsonValue = z.infer<typeof JsonValueSchema>
export type StartRunResponse = z.infer<typeof StartRunResponseSchema>
export type RunHistoryEntry = z.infer<typeof RunHistoryEntrySchema>
export type RunHistoryPage = z.infer<typeof RunHistoryPageSchema>
export type RunDetailResponse = z.infer<typeof RunDetailResponseSchema>

export type ParsedRunDetail =
  | Readonly<{ status: 'READY'; value: RunDetailResponse }>
  | Readonly<{
      status: 'CORRUPT'
      diagnostic: z.infer<typeof RunDiagnosticSchema>
    }>

const runDurationMs = (run: z.infer<typeof RunProjectionSchema>): number | null =>
  run.startedAt === null || run.completedAt === null
    ? null
    : Math.max(0, Date.parse(run.completedAt) - Date.parse(run.startedAt))

export const normalizeRunHistory = (input: unknown): RunHistoryPage => {
  const filesystem = FilesystemRunIndexPageSchema.parse(input)
  return RunHistoryPageSchema.parse({
    data: filesystem.data.map((entry) =>
      entry.status === 'READY'
        ? {
            runId: entry.run.runId,
            workflowId: entry.run.workflowId,
            status: entry.run.status,
            createdAt: entry.run.createdAt,
            startedAt: entry.run.startedAt,
            completedAt: entry.run.completedAt,
            durationMs: runDurationMs(entry.run),
          }
        : {
            runId: entry.locator.runId,
            workflowId: entry.locator.workflowId,
            status: 'CORRUPT' as const,
            createdAt: null,
            startedAt: null,
            completedAt: null,
            durationMs: null,
            diagnostic: entry.diagnostic,
          },
    ),
    pagination: filesystem.pagination,
  })
}

export const parseRunDetail = (input: unknown): ParsedRunDetail => {
  const filesystem = FilesystemRunDetailSchema.parse(input)
  if (filesystem.status === 'CORRUPT') {
    return { status: 'CORRUPT', diagnostic: filesystem.diagnostic }
  }

  return {
    status: 'READY',
    value: RunDetailResponseSchema.parse({
      run: {
        ...filesystem.run,
        workflowSnapshot: workflowFileToWorkflow(filesystem.workflowSnapshot.workflow),
        variables: filesystem.variablesSnapshot.values,
      },
      events: filesystem.events,
      nodeExecutions: filesystem.executions.map(
        ({ schemaVersion, runId, lastEventSequence, ...execution }) => {
          void schemaVersion
          void runId
          void lastEventSequence
          return execution
        },
      ),
      repositories: filesystem.repositoriesSnapshot.repositories.map(
        ({ webUrl, ...repository }) => {
          void webUrl
          return repository
        },
      ),
      repositoryWorkspaces: filesystem.workspaces.workspaces,
    }),
  }
}
