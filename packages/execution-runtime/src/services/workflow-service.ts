import { WorkflowIdSchema } from '@loop/contracts'
import type { Workflow } from '@loop/workflow-model'

import type { WorkflowRepository } from '../persistence/workflow-repository.js'

export type WorkflowServiceErrorCode = 'WORKFLOW_NOT_FOUND'

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
}

export const createWorkflowService = (options: {
  readonly workflows: WorkflowRepository
}): WorkflowService => ({
  list: () => options.workflows.list(),
  get(workflowIdInput) {
    const workflowId = WorkflowIdSchema.parse(workflowIdInput)
    const workflow = options.workflows.get(workflowId)
    if (workflow === undefined) {
      throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Workflow was not found')
    }
    return workflow
  },
})
