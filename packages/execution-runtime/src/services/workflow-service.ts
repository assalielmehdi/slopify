import { NodeIdSchema, RevisionIdSchema, WorkflowIdSchema } from '@loop/contracts'
import {
  PermissionProfileSchema,
  ResourceBundleIdSchema,
  WorkspacePolicySchema,
  WorkflowRevisionDerivationError,
  derivePredefinedV1Revision,
  type AgentNodeConfigurationChanges,
  type WorkflowRevision,
} from '@loop/workflow-model'
import { z } from 'zod'

import { PersistenceError } from '../persistence/errors.js'
import type { WorkflowRepository } from '../persistence/workflow-repository.js'

const configurationChanges = z.strictObject({
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  thinkingLevel: z.string().trim().min(1).optional(),
  promptTemplate: z.string().min(1).optional(),
  workspacePolicy: WorkspacePolicySchema.optional(),
  permissionProfile: PermissionProfileSchema.optional(),
  resourceBundleId: ResourceBundleIdSchema.optional(),
  outputSchemaRef: z.string().trim().min(1).optional(),
  timeoutSeconds: z.number().int().positive().safe().optional(),
})

const createRevisionRequest = z.strictObject({
  parentRevisionId: RevisionIdSchema,
  revisionId: RevisionIdSchema,
  updates: z
    .array(
      z.strictObject({
        nodeId: NodeIdSchema,
        changes: configurationChanges,
      }),
    )
    .min(1)
    .max(64)
    .readonly(),
})

const definedChanges = (
  changes: z.infer<typeof configurationChanges>,
): AgentNodeConfigurationChanges =>
  Object.fromEntries(Object.entries(changes).filter((entry) => entry[1] !== undefined))

export type WorkflowServiceErrorCode =
  'REVISION_CONFLICT' | 'REVISION_INVALID' | 'WORKFLOW_NOT_FOUND' | 'WORKFLOW_REQUEST_INVALID'

export class WorkflowServiceError extends Error {
  override readonly name = 'WorkflowServiceError'

  constructor(
    readonly code: WorkflowServiceErrorCode,
    message: string,
    readonly details?: unknown,
    options?: Readonly<{ cause?: unknown }>,
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
  }
}

export interface WorkflowCatalogEntry {
  readonly workflowId: string
  readonly name: string
  readonly latestRevisionId: string
  readonly revisions: readonly {
    readonly revisionId: string
    readonly parentRevisionId: string | null
    readonly createdAt: string
  }[]
}

export interface WorkflowService {
  list(): readonly WorkflowCatalogEntry[]
  get(workflowId: string, revisionId: string): WorkflowRevision
  create(workflowId: string, input: unknown): WorkflowRevision
}

export const createWorkflowService = (options: {
  readonly workflows: WorkflowRepository
  readonly now?: () => string
}): WorkflowService => {
  const now = options.now ?? (() => new Date().toISOString())

  const get = (workflowIdInput: string, revisionIdInput: string): WorkflowRevision => {
    const workflowId = WorkflowIdSchema.parse(workflowIdInput)
    const revisionId = RevisionIdSchema.parse(revisionIdInput)
    const revision = options.workflows.getRevision({ workflowId, revisionId })
    if (revision === undefined) {
      throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Workflow revision was not found')
    }
    return revision
  }

  return {
    list() {
      const grouped = new Map<string, WorkflowRevision[]>()
      for (const revision of options.workflows.listRevisions()) {
        const revisions = grouped.get(revision.workflowId) ?? []
        revisions.push(revision)
        grouped.set(revision.workflowId, revisions)
      }
      return [...grouped.values()].map((revisions) => {
        const latest = revisions[0]
        if (latest === undefined) {
          throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Workflow revision was not found')
        }
        return {
          workflowId: latest.workflowId,
          name: latest.name,
          latestRevisionId: latest.revisionId,
          revisions: revisions.map((revision) => ({
            revisionId: revision.revisionId,
            parentRevisionId: revision.parentRevisionId ?? null,
            createdAt: revision.createdAt,
          })),
        }
      })
    },

    get,

    create(workflowIdInput, input) {
      const parsed = createRevisionRequest.safeParse(input)
      if (!parsed.success) {
        throw new WorkflowServiceError(
          'WORKFLOW_REQUEST_INVALID',
          'Workflow revision request is invalid',
          { issues: parsed.error.issues.map(({ code, path }) => ({ code, path })) },
        )
      }
      const workflowId = WorkflowIdSchema.parse(workflowIdInput)
      const parent = get(workflowId, parsed.data.parentRevisionId)
      try {
        const revision = derivePredefinedV1Revision(parent, {
          revisionId: parsed.data.revisionId,
          createdAt: now(),
          updates: parsed.data.updates.map((update) => ({
            nodeId: update.nodeId,
            changes: definedChanges(update.changes),
          })),
        })
        options.workflows.addRevision(revision)
        return revision
      } catch (cause) {
        if (cause instanceof WorkflowRevisionDerivationError) {
          throw new WorkflowServiceError(
            cause.code === 'REVISION_ID_REUSED' ? 'REVISION_CONFLICT' : 'REVISION_INVALID',
            cause.code === 'REVISION_ID_REUSED'
              ? 'Workflow revision already exists'
              : 'Workflow revision is invalid',
            { path: cause.path },
            { cause },
          )
        }
        if (cause instanceof PersistenceError && cause.code === 'PERSISTENCE_CONFLICT') {
          throw new WorkflowServiceError(
            'REVISION_CONFLICT',
            'Workflow revision already exists',
            undefined,
            { cause },
          )
        }
        throw cause
      }
    },
  }
}
