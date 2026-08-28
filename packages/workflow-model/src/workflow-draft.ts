import { WorkflowSchema } from './schemas.js'
import type { CreateWorkflowInput, Workflow } from './types.js'

export const WORKFLOW_DRAFT_TRANSITION_LIMIT = 100

export interface CreateWorkflowDraftInput extends CreateWorkflowInput {
  readonly createdAt: string
}

export function createWorkflowDraft(input: CreateWorkflowDraftInput): Workflow {
  return WorkflowSchema.parse({
    schemaVersion: 3,
    workflowId: input.workflowId,
    description: input.description,
    configuration: input.configuration,
    startNodeId: null,
    nodes: [],
    edges: [],
    maxTransitions: WORKFLOW_DRAFT_TRANSITION_LIMIT,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  })
}
