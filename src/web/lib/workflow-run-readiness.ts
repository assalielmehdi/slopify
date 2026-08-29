import type { HarnessDescriptor, Repository } from '@slopify/shared'
import { validateWorkflow, type Workflow } from '@slopify/shared'

export interface WorkflowRunReadinessInput {
  readonly harnesses?: readonly HarnessDescriptor[] | undefined
  readonly repositories?: readonly Repository[] | undefined
  readonly workflow: Workflow
}

export const workflowRunDisabledReason = ({
  harnesses,
  repositories,
  workflow,
}: WorkflowRunReadinessInput): string | undefined => {
  if (workflow.nodes.length === 0) return 'Add an agent before starting a run.'

  const validation = validateWorkflow(workflow)
  if (!validation.valid) {
    return 'Connect every agent to make this workflow runnable.'
  }

  if (
    workflow.configuration.repositoryIds.length === 0 ||
    workflow.configuration.primaryRepositoryId === null
  ) {
    return 'Select at least one repository and a primary repository in workflow configuration.'
  }
  if (repositories === undefined) {
    return 'Repositories could not be loaded. Resolve repository discovery before running.'
  }
  if (
    workflow.configuration.repositoryIds.some(
      (repositoryId) =>
        repositories.find((repository) => repository.repositoryId === repositoryId)
          ?.availability !== 'AVAILABLE',
    )
  ) {
    return 'Every selected repository must be available on this machine before running.'
  }

  if (harnesses === undefined) {
    return 'Harnesses could not be loaded. Resolve harness discovery before running.'
  }
  for (const node of workflow.nodes) {
    const harness = harnesses.find(({ harnessId }) => harnessId === node.harness.harnessId)
    if (harness?.availability !== 'AVAILABLE') {
      return `${harness?.name ?? node.harness.harnessId} is unavailable. Open Harnesses to install or repair it before running.`
    }
    const model =
      node.harness.modelId === undefined
        ? undefined
        : harness.models.find(({ id }) => id === node.harness.modelId)
    if (node.harness.modelId !== undefined && model === undefined) {
      return `${node.name} cannot run because its selected model is unavailable.`
    }
    const availableThinkingLevels = model?.thinkingLevels ?? [
      ...new Set(harness.models.flatMap(({ thinkingLevels }) => thinkingLevels)),
    ]
    if (
      node.harness.thinkingLevel !== undefined &&
      !availableThinkingLevels.includes(node.harness.thinkingLevel)
    ) {
      return `${node.name} cannot run because its selected thinking effort is unavailable.`
    }
  }

  return undefined
}
