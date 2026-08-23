import { WorkflowSchema } from './schemas.js'
import type { Workflow } from './types.js'

export const DEFAULT_WORKFLOW_ID = 'default-workflow'
export const DEFAULT_WORKFLOW_TRANSITION_LIMIT = 100

export interface CreateDefaultWorkflowInput {
  readonly createdAt: string
}

export function createDefaultWorkflow(input: CreateDefaultWorkflowInput): Workflow {
  return WorkflowSchema.parse({
    schemaVersion: 1,
    workflowId: DEFAULT_WORKFLOW_ID,
    name: 'Untitled workflow',
    description: 'Add agents and connect them to build a workflow.',
    configuration: { projectIds: [], primaryProjectId: null, variables: [] },
    startNodeId: null,
    nodes: [],
    edges: [],
    maxTransitions: DEFAULT_WORKFLOW_TRANSITION_LIMIT,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  })
}
