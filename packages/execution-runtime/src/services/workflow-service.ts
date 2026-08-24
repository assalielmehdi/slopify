import { WorkflowIdSchema } from '@slopify/contracts'
import {
  CreateWorkflowInputSchema,
  DEFAULT_WORKFLOW_TRANSITION_LIMIT,
  WorkflowSchema,
  createWorkflowDraft,
  type Workflow,
} from '@slopify/workflow-model'

import type { HarnessCatalog } from '../harnesses/harness-catalog.js'
import { PersistenceError } from '../persistence/errors.js'
import type { WorkflowRepository } from '../persistence/workflow-repository.js'

export type WorkflowServiceErrorCode =
  | 'WORKFLOW_ID_CONFLICT'
  | 'WORKFLOW_ID_MISMATCH'
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

export interface WorkflowService {
  list(): readonly Workflow[]
  get(workflowId: string): Workflow
  create(input: unknown): Workflow
  update(workflowId: string, workflow: unknown): Promise<Workflow>
}

export const createWorkflowService = (options: {
  readonly workflows: WorkflowRepository
  readonly harnesses: Pick<HarnessCatalog, 'requireAvailable'>
  readonly createId?: () => string
  readonly now?: () => string
}): WorkflowService => {
  const createId = options.createId ?? (() => `workflow-${crypto.randomUUID()}`)
  const now = options.now ?? (() => new Date().toISOString())

  const get = (workflowIdInput: string): Workflow => {
    const workflowId = WorkflowIdSchema.parse(workflowIdInput)
    const workflow = options.workflows.get(workflowId)
    if (workflow === undefined)
      throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Workflow was not found')
    return workflow
  }

  return {
    list: () => options.workflows.list(),
    get,
    create(input) {
      const timestamp = now()
      const workflow = createWorkflowDraft({
        ...CreateWorkflowInputSchema.parse(input),
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
