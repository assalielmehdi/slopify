import {
  DeletionIdSchema,
  DeletionReceiptSchema,
  WorkflowIdSchema,
  type DeletionReceipt,
} from '@slopify/contracts'
import {
  CreateWorkflowInputSchema,
  DEFAULT_WORKFLOW_TRANSITION_LIMIT,
  WorkflowNameSchema,
  WorkflowSchema,
  createWorkflowDraft,
  type Workflow,
} from '@slopify/workflow-model'

import type { HarnessCatalog } from '../harnesses/harness-catalog.js'
import type { ReversibleDeletionHandler } from '../deletions/deletion-service.js'
import { PersistenceError } from '../persistence/errors.js'
import type { WorkflowRepository } from '../persistence/workflow-repository.js'

export type WorkflowServiceErrorCode =
  | 'WORKFLOW_ID_CONFLICT'
  | 'WORKFLOW_ID_MISMATCH'
  | 'WORKFLOW_NAME_CONFLICT'
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_HARNESS_UNAVAILABLE'

export class WorkflowServiceError extends Error {
  override readonly name = 'WorkflowServiceError'

  constructor(
    readonly code: WorkflowServiceErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface WorkflowService extends ReversibleDeletionHandler {
  list(): readonly Workflow[]
  get(workflowId: string): Workflow
  create(input: unknown): Workflow
  delete(workflowId: string): DeletionReceipt
  update(workflowId: string, workflow: unknown): Promise<Workflow>
}

export const createWorkflowService = (options: {
  readonly workflows: WorkflowRepository
  readonly harnesses: Pick<HarnessCatalog, 'requireAvailable'>
  readonly createId?: () => string
  readonly createDeletionId?: () => string
  readonly now?: () => string
  readonly undoWindowMs?: number
}): WorkflowService => {
  const createId = options.createId ?? (() => `workflow-${crypto.randomUUID()}`)
  const createDeletionId = options.createDeletionId ?? (() => `deletion-${crypto.randomUUID()}`)
  const now = options.now ?? (() => new Date().toISOString())
  const undoWindowMs = options.undoWindowMs ?? 10_000

  const purgeExpired = (): void => options.workflows.purgeExpired(now())

  const get = (workflowIdInput: string): Workflow => {
    purgeExpired()
    const workflowId = WorkflowIdSchema.parse(workflowIdInput)
    const workflow = options.workflows.get(workflowId)
    if (workflow === undefined)
      throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Workflow was not found')
    return workflow
  }

  const requireUniqueName = (name: string, workflowId?: string): void => {
    if (
      options.workflows
        .list()
        .some((workflow) => workflow.workflowId !== workflowId && workflow.name === name)
    ) {
      throw new WorkflowServiceError('WORKFLOW_NAME_CONFLICT', 'Workflow name already exists')
    }
  }

  return {
    subjectType: 'WORKFLOW',
    list: () => {
      purgeExpired()
      return options.workflows.list()
    },
    get,
    delete(workflowIdInput) {
      const workflow = get(workflowIdInput)
      const deletedAt = now()
      const receipt = DeletionReceiptSchema.parse({
        deletionId: DeletionIdSchema.parse(createDeletionId()),
        subject: { type: 'WORKFLOW', id: workflow.workflowId },
        deletedAt,
        undoExpiresAt: new Date(Date.parse(deletedAt) + undoWindowMs).toISOString(),
      })
      if (!options.workflows.stageDeletion(receipt)) {
        throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Workflow was not found')
      }
      return receipt
    },
    async undoDeletion(deletionId) {
      return options.workflows.restoreDeletion(DeletionIdSchema.parse(deletionId), now())
    },
    create(input) {
      const parsedInput = CreateWorkflowInputSchema.parse(input)
      requireUniqueName(parsedInput.name)
      const timestamp = now()
      const workflow = createWorkflowDraft({
        ...parsedInput,
        workflowId: WorkflowIdSchema.parse(createId()),
        createdAt: timestamp,
      })
      try {
        options.workflows.insert(workflow)
      } catch (cause) {
        if (cause instanceof PersistenceError && cause.code === 'PERSISTENCE_CONFLICT') {
          throw new WorkflowServiceError('WORKFLOW_ID_CONFLICT', 'Workflow ID already exists')
        }
        throw cause
      }
      return workflow
    },
    async update(workflowIdInput, workflowInput) {
      const workflowId = WorkflowIdSchema.parse(workflowIdInput)
      const existing = get(workflowId)
      const requested = WorkflowSchema.parse(workflowInput)
      if (requested.workflowId !== workflowId)
        throw new WorkflowServiceError(
          'WORKFLOW_ID_MISMATCH',
          'Workflow ID does not match the requested resource',
        )
      if (requested.name !== existing.name) {
        WorkflowNameSchema.parse(requested.name)
        requireUniqueName(requested.name, workflowId)
      }
      const nodes = await Promise.all(
        requested.nodes.map(async (node) => {
          try {
            await options.harnesses.requireAvailable(
              node.harness.harnessId,
              node.harness.modelId,
              node.harness.thinkingLevel,
            )
          } catch {
            throw new WorkflowServiceError(
              'WORKFLOW_HARNESS_UNAVAILABLE',
              'The selected agent harness or model is unavailable',
            )
          }
          return node
        }),
      )
      const workflow = WorkflowSchema.parse({
        ...requested,
        workflowId,
        nodes,
        maxTransitions: DEFAULT_WORKFLOW_TRANSITION_LIMIT,
        createdAt: existing.createdAt,
        updatedAt: now(),
      })
      options.workflows.save(workflow)
      return workflow
    },
  }
}
