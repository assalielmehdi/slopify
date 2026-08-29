import {
  GitProviderSchema,
  GitShaSchema,
  NodeExecutionStatusSchema,
  NodeIdSchema,
  RepositoryIdSchema,
  RunIdSchema,
  RunStatusSchema,
  WorkflowIdSchema,
} from '@slopify/shared'
import { WorkflowFileSchema, WorkflowVariableNameSchema } from '@slopify/shared'
import { isAbsolute } from 'node:path'
import { z } from 'zod'

const timestamp = z.iso.datetime({ offset: true })
const sequence = z.number().int().nonnegative().safe()
const executionId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u)
const errorCode = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/u)
const absolutePath = z.string().trim().min(1).max(4_096).refine(isAbsolute, {
  message: 'Workspace path must be absolute',
})

export const RunWorkflowSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  capturedAt: timestamp,
  workflowRevision: z.string().regex(/^[0-9a-f]{64}$/u),
  workflow: WorkflowFileSchema,
})

export const RunVariablesSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  values: z.record(WorkflowVariableNameSchema, z.json()),
})

const RunRepositorySnapshotSchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  position: z.number().int().nonnegative().safe(),
  name: z.string().trim().min(1).max(256),
  provider: GitProviderSchema,
  remoteId: z.string().regex(/^\d+$/u).max(128),
  fullName: z.string().trim().min(1).max(512),
  cloneUrl: z.url({ protocol: /^https$/u }).max(4_096),
  webUrl: z.url({ protocol: /^https$/u }).max(4_096),
  defaultBranch: z.string().trim().min(1).max(512),
  baseSha: GitShaSchema,
  isPrimary: z.boolean(),
})

export const RunRepositoriesSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    repositories: z.array(RunRepositorySnapshotSchema).min(1).max(32).readonly(),
  })
  .superRefine(({ repositories }, context) => {
    const repositoryIds = new Set<string>()
    const positions = new Set<number>()
    let primaryCount = 0
    for (const [index, repository] of repositories.entries()) {
      if (repositoryIds.has(repository.repositoryId)) {
        context.addIssue({
          code: 'custom',
          message: 'Repository IDs must be unique',
          path: ['repositories', index, 'repositoryId'],
        })
      }
      if (positions.has(repository.position)) {
        context.addIssue({
          code: 'custom',
          message: 'Repository positions must be unique',
          path: ['repositories', index, 'position'],
        })
      }
      repositoryIds.add(repository.repositoryId)
      positions.add(repository.position)
      if (repository.isPrimary) primaryCount += 1
    }
    if (primaryCount !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'Exactly one repository must be primary',
        path: ['repositories'],
      })
    }
  })

export const RunProjectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  status: RunStatusSchema,
  transitionCount: z.number().int().nonnegative().safe(),
  lastEventSequence: sequence,
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  failureCode: errorCode.nullable(),
})

export const RunWorkspaceStatusSchema = z.enum(['PREPARING', 'READY', 'FAILED', 'CLEANED'])

const RunWorkspaceProjectionSchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  position: z.number().int().nonnegative().safe(),
  status: RunWorkspaceStatusSchema,
  workspacePath: absolutePath,
  branchName: z.string().trim().min(1).max(512),
  errorMessage: z.string().trim().min(1).max(4_096).nullable(),
  preparedAt: timestamp.nullable(),
  cleanedAt: timestamp.nullable(),
  updatedAt: timestamp,
})

export const RunWorkspacesProjectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  lastEventSequence: sequence,
  workspaces: z.array(RunWorkspaceProjectionSchema).max(32).readonly(),
})

export const NodeExecutionProjectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  nodeExecutionId: executionId,
  attemptId: executionId,
  nodeId: NodeIdSchema,
  executionIndex: z.number().int().nonnegative().safe(),
  status: NodeExecutionStatusSchema,
  lastEventSequence: sequence,
  output: z.json().nullable(),
  outcome: z.string().trim().min(1).max(128).nullable(),
  errorCode: errorCode.nullable(),
  errorMessage: z.string().trim().min(1).max(4_096).nullable(),
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  durationMs: z.number().int().nonnegative().safe().nullable(),
})

export const RUN_ARTIFACT_AUTHORITY = {
  workflowSnapshot: 'IMMUTABLE_FACT',
  variablesSnapshot: 'IMMUTABLE_FACT',
  repositoriesSnapshot: 'IMMUTABLE_FACT',
  runEvents: 'APPEND_ONLY_FACT',
  traceEvents: 'APPEND_ONLY_FACT',
  run: 'REBUILDABLE_PROJECTION',
  workspaces: 'REBUILDABLE_PROJECTION',
  nodeExecution: 'REBUILDABLE_PROJECTION',
} as const

export type RunWorkflowSnapshot = z.infer<typeof RunWorkflowSnapshotSchema>
export type RunVariablesSnapshot = z.infer<typeof RunVariablesSnapshotSchema>
export type RunRepositorySnapshotArtifact = z.infer<typeof RunRepositorySnapshotSchema>
export type RunRepositoriesSnapshot = z.infer<typeof RunRepositoriesSnapshotSchema>
export type RunProjection = z.infer<typeof RunProjectionSchema>
export type RunWorkspaceStatus = z.infer<typeof RunWorkspaceStatusSchema>
export type RunWorkspaceProjection = z.infer<typeof RunWorkspaceProjectionSchema>
export type RunWorkspacesProjection = z.infer<typeof RunWorkspacesProjectionSchema>
export type NodeExecutionProjection = z.infer<typeof NodeExecutionProjectionSchema>
