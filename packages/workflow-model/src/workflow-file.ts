import { WorkflowFileSchema, WorkflowSchema } from './schemas.js'
import type { Workflow, WorkflowFile } from './types.js'

export function workflowToWorkflowFile(workflow: Workflow): WorkflowFile {
  return WorkflowFileSchema.parse({
    schemaVersion: workflow.schemaVersion,
    workflowId: workflow.workflowId,
    name: workflow.name,
    description: workflow.description,
    repositories: {
      repositoryIds: workflow.configuration.repositoryIds,
      primaryRepositoryId: workflow.configuration.primaryRepositoryId,
    },
    variables: workflow.configuration.variables,
    graph: {
      startNodeId: workflow.startNodeId,
      nodes: workflow.nodes,
      edges: workflow.edges,
      maxTransitions: workflow.maxTransitions,
    },
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  })
}

export function workflowFileToWorkflow(workflowFile: WorkflowFile): Workflow {
  return WorkflowSchema.parse({
    schemaVersion: workflowFile.schemaVersion,
    workflowId: workflowFile.workflowId,
    name: workflowFile.name,
    description: workflowFile.description,
    configuration: {
      repositoryIds: workflowFile.repositories.repositoryIds,
      primaryRepositoryId: workflowFile.repositories.primaryRepositoryId,
      variables: workflowFile.variables,
    },
    startNodeId: workflowFile.graph.startNodeId,
    nodes: workflowFile.graph.nodes,
    edges: workflowFile.graph.edges,
    maxTransitions: workflowFile.graph.maxTransitions,
    createdAt: workflowFile.createdAt,
    updatedAt: workflowFile.updatedAt,
  })
}
