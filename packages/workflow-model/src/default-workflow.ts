import { CanonicalWorkflowIdSchema, WorkflowSchema } from './schemas.js'
import type { CreateWorkflowInput, Workflow } from './types.js'

export const DEFAULT_WORKFLOW_ID = CanonicalWorkflowIdSchema.parse('default-workflow')
export const DEFAULT_WORKFLOW_TRANSITION_LIMIT = 100

export interface CreateDefaultWorkflowInput {
  readonly createdAt: string
}

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
    maxTransitions: DEFAULT_WORKFLOW_TRANSITION_LIMIT,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  })
}

export function createDefaultWorkflow(input: CreateDefaultWorkflowInput): Workflow {
  return createWorkflowDraft({
    workflowId: DEFAULT_WORKFLOW_ID,
    description: 'Add agents and connect them to build a workflow.',
    configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
    createdAt: input.createdAt,
  })
}
