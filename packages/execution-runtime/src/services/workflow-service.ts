import { NodeIdSchema, RevisionIdSchema, WorkflowIdSchema } from '@loop/contracts'
import {
  AgentInferenceConfigurationSchema,
  SkillSnapshotReferenceSchema,
  WorkflowRevisionDerivationError,
  derivePredefinedV1Revision,
  type AgentNodeConfigurationChanges,
  type WorkflowRevision,
} from '@loop/workflow-model'
import { z } from 'zod'

import { PersistenceError } from '../persistence/errors.js'
import type { WorkflowRepository } from '../persistence/workflow-repository.js'
import type { SkillCatalog, SkillSnapshotStore } from '../skills/skill-catalog.js'

const configurationChanges = z.strictObject({
  name: z.string().trim().min(1).max(256).optional(),
  prompt: z.string().min(1).optional(),
  skillIds: z
    .array(z.string().trim().min(1).max(128))
    .max(32)
    .refine((values) => new Set(values).size === values.length, 'Skill IDs must be unique')
    .readonly()
    .optional(),
  connectionId: z.string().trim().min(1).max(128).optional(),
  modelId: z.string().trim().min(1).max(256).optional(),
  thinkingLevel: AgentInferenceConfigurationSchema.unwrap().shape.thinkingLevel.optional(),
  connectorIds: z.array(z.string().trim().min(1).max(128)).max(32).readonly().optional(),
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

const definedChanges = async (
  changes: z.infer<typeof configurationChanges>,
  options: Readonly<{ skills?: SkillCatalog; skillSnapshots?: SkillSnapshotStore }>,
): Promise<AgentNodeConfigurationChanges> => {
  const result = Object.fromEntries(
    Object.entries(changes).filter(([key, value]) => key !== 'skillIds' && value !== undefined),
  ) as AgentNodeConfigurationChanges
  if (changes.skillIds === undefined) return result
  const skills = options.skills
  const skillSnapshots = options.skillSnapshots
  if (skills === undefined || skillSnapshots === undefined)
    throw new WorkflowServiceError('REVISION_INVALID', 'Skill snapshots are unavailable')
  const snapshots = await Promise.all(
    changes.skillIds.map(async (skillId) => {
      const snapshot = await skillSnapshots.capture(await skills.get(skillId))
      return SkillSnapshotReferenceSchema.parse({
        snapshotId: snapshot.snapshotId,
        skillId: snapshot.skillId,
        name: snapshot.name,
        description: snapshot.description,
        digest: snapshot.digest,
      })
    }),
  )
  return { ...result, skillSnapshotRefs: snapshots }
}

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
  create(workflowId: string, input: unknown): Promise<WorkflowRevision>
}

export const createWorkflowService = (options: {
  readonly workflows: WorkflowRepository
  readonly skills?: SkillCatalog
  readonly skillSnapshots?: SkillSnapshotStore
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

    async create(workflowIdInput, input) {
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
          updates: await Promise.all(
            parsed.data.updates.map(async (update) => ({
              nodeId: update.nodeId,
              changes: await definedChanges(update.changes, options),
            })),
          ),
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
