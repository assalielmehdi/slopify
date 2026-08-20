import {
  WorkflowRevisionSchema,
  validateWorkflow,
  type DerivePredefinedV1RevisionInput,
  type WorkflowRevision,
} from '@loop/workflow-model'

export const PREDEFINED_V1_WORKFLOW_ID = 'delivery-workflow'
export const PREDEFINED_V1_TRANSITION_LIMIT = 24
export const PREDEFINED_V1_COMMAND_IDS = Object.freeze([
  'load-clickup-task',
  'prepare-git-worktrees',
  'verify-selected-repositories',
  'aggregate-review-findings',
  'finalize-gitlab-delivery',
])

export interface PredefinedV1AgentDefaults {
  readonly provider: string
  readonly model: string
  readonly thinkingLevel: string
}

export interface CreatePredefinedV1RevisionInput {
  readonly revisionId: string
  readonly createdAt: string
  readonly agentDefaults: PredefinedV1AgentDefaults
}

interface AgentNodeDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly promptTemplate: string
  readonly workspacePolicy: string
  readonly permissionProfile: string
  readonly resourceBundleId: string
  readonly inputArtifacts: readonly string[]
  readonly outputSchemaRef: string
  readonly outcomes: readonly string[]
  readonly timeoutSeconds: number
}

function createAgentNode(
  definition: AgentNodeDefinition,
  defaults: PredefinedV1AgentDefaults,
): object {
  return {
    type: 'agent',
    id: definition.id,
    name: definition.name,
    description: definition.description,
    timeoutSeconds: definition.timeoutSeconds,
    result: { schemaRef: definition.outputSchemaRef },
    sandbox: { profileId: 'agent-default-v1', imageId: 'gondolin-alpine-v1' },
    job: {
      kind: 'agent',
      prompt: definition.promptTemplate,
      skillSnapshotRefs: [],
      inference: {
        connectionId: `${defaults.provider}-default`,
        modelId: defaults.model,
        thinkingLevel: defaults.thinkingLevel,
      },
      connectorIds: [],
    },
  }
}

export function createDeliveryWorkflowTestRevision(
  input: CreatePredefinedV1RevisionInput,
): WorkflowRevision {
  const nodes = [
    {
      type: 'command',
      id: 'load-clickup-task',
      name: 'Load ClickUp task',
      description: 'Resolve and snapshot the approved self-contained task.',
      commandId: 'load-clickup-task',
      outcomes: ['loaded'],
      timeoutSeconds: 60,
    },
    createAgentNode(
      {
        id: 'select-repositories',
        name: 'Select affected repositories',
        description: 'Select the exact candidate repositories that the task must change.',
        promptTemplate:
          'Inspect the approved task and every configured candidate repository. Return a complete selected/excluded partition with concise rationale and responsibility.',
        workspacePolicy: 'candidate-repositories',
        permissionProfile: 'read-only',
        resourceBundleId: 'repository-selection-v1',
        inputArtifacts: [],
        outputSchemaRef: 'workflow-output/repository-selection-v1',
        outcomes: ['selected', 'blocked'],
        timeoutSeconds: 600,
      },
      input.agentDefaults,
    ),
    {
      type: 'command',
      id: 'prepare-worktrees',
      name: 'Prepare Git worktrees',
      description: 'Create isolated branches and worktrees for the selected repositories.',
      commandId: 'prepare-git-worktrees',
      outcomes: ['ready'],
      timeoutSeconds: 300,
    },
    createAgentNode(
      {
        id: 'plan',
        name: 'Plan',
        description: 'Produce the architecture and execution plan for every selected repository.',
        promptTemplate:
          'Plan the approved task across the selected worktrees. Define repository responsibilities, cross-repository contracts, verification, risks, and ordered execution.',
        workspacePolicy: 'selected-worktrees',
        permissionProfile: 'read-only',
        resourceBundleId: 'delivery-planning-v1',
        inputArtifacts: [],
        outputSchemaRef: 'workflow-output/execution-plan-v1',
        outcomes: ['ready', 'blocked'],
        timeoutSeconds: 1_200,
      },
      input.agentDefaults,
    ),
    createAgentNode(
      {
        id: 'implement',
        name: 'Implement',
        description: 'Implement and commit the approved plan in every selected worktree.',
        promptTemplate:
          'Implement only the approved execution plan across the selected worktrees. Verify changes incrementally and commit each repository-specific result.',
        workspacePolicy: 'selected-worktrees',
        permissionProfile: 'workspace-write',
        resourceBundleId: 'delivery-implementation-v1',
        inputArtifacts: ['EXECUTION_PLAN'],
        outputSchemaRef: 'workflow-output/implementation-summary-v1',
        outcomes: ['implemented', 'blocked'],
        timeoutSeconds: 3_600,
      },
      input.agentDefaults,
    ),
    {
      type: 'command',
      id: 'verify',
      name: 'Verify',
      description: 'Run every configured verification command and normalize its evidence.',
      commandId: 'verify-selected-repositories',
      outcomes: ['passed', 'failed-checks'],
      timeoutSeconds: 1_800,
    },
    createAgentNode(
      {
        id: 'requirements-review',
        name: 'Requirements review',
        description: 'Review the implementation against the approved task and definition of done.',
        promptTemplate:
          'Review the base-to-HEAD changes and verification evidence against every approved requirement. Return only repository-addressed actionable findings.',
        workspacePolicy: 'selected-worktrees',
        permissionProfile: 'read-only',
        resourceBundleId: 'requirements-review-v1',
        inputArtifacts: ['EXECUTION_PLAN', 'IMPLEMENTATION_SUMMARY'],
        outputSchemaRef: 'workflow-output/review-findings-v1',
        outcomes: ['reviewed', 'blocked'],
        timeoutSeconds: 900,
      },
      input.agentDefaults,
    ),
    createAgentNode(
      {
        id: 'security-review',
        name: 'Security review',
        description: 'Review the task change for security and trust-boundary defects.',
        promptTemplate:
          'Review the base-to-HEAD changes for exploitable security and trust-boundary defects within task scope. Return only repository-addressed actionable findings.',
        workspacePolicy: 'selected-worktrees',
        permissionProfile: 'read-only',
        resourceBundleId: 'security-review-v1',
        inputArtifacts: ['EXECUTION_PLAN', 'IMPLEMENTATION_SUMMARY'],
        outputSchemaRef: 'workflow-output/review-findings-v1',
        outcomes: ['reviewed', 'blocked'],
        timeoutSeconds: 900,
      },
      input.agentDefaults,
    ),
    createAgentNode(
      {
        id: 'simplification-review',
        name: 'Simplification review',
        description: 'Review the task change for unnecessary complexity and maintenance defects.',
        promptTemplate:
          'Review the base-to-HEAD changes for unnecessary complexity and maintainability defects without expanding scope. Return only repository-addressed actionable findings.',
        workspacePolicy: 'selected-worktrees',
        permissionProfile: 'read-only',
        resourceBundleId: 'simplification-review-v1',
        inputArtifacts: ['EXECUTION_PLAN', 'IMPLEMENTATION_SUMMARY'],
        outputSchemaRef: 'workflow-output/review-findings-v1',
        outcomes: ['reviewed', 'blocked'],
        timeoutSeconds: 900,
      },
      input.agentDefaults,
    ),
    {
      type: 'command',
      id: 'aggregate-review',
      name: 'Aggregate review',
      description: 'Combine findings, maintain the review summary, and route the result.',
      commandId: 'aggregate-review-findings',
      outcomes: ['changes-required', 'clean'],
      timeoutSeconds: 120,
    },
    createAgentNode(
      {
        id: 'fix-findings',
        name: 'Fix findings',
        description: 'Fix only verification failures and aggregated review findings.',
        promptTemplate:
          'Resolve only the current verification failures and aggregated review findings in their selected worktrees. Commit the fixes and return repository-addressed resolution evidence.',
        workspacePolicy: 'selected-worktrees',
        permissionProfile: 'workspace-write',
        resourceBundleId: 'finding-resolution-v1',
        inputArtifacts: ['REVIEW_SUMMARY'],
        outputSchemaRef: 'workflow-output/finding-resolution-v1',
        outcomes: ['fixed', 'blocked'],
        timeoutSeconds: 1_800,
      },
      input.agentDefaults,
    ),
    {
      type: 'command',
      id: 'finalize-delivery',
      name: 'Finalize delivery',
      description: 'Create and verify merge requests, publish finalization, and move to In Review.',
      commandId: 'finalize-gitlab-delivery',
      outcomes: ['delivered'],
      timeoutSeconds: 600,
    },
    { type: 'terminal', id: 'failed', name: 'Failed', terminalStatus: 'FAILED' },
    { type: 'terminal', id: 'succeeded', name: 'Succeeded', terminalStatus: 'SUCCEEDED' },
  ]

  const edges = [
    ['load-clickup-task', 'loaded', 'select-repositories', 'Task loaded'],
    ['select-repositories', 'selected', 'prepare-worktrees', 'Repositories selected'],
    ['select-repositories', 'blocked', 'failed', 'Selection blocked'],
    ['prepare-worktrees', 'ready', 'plan', 'Worktrees ready'],
    ['plan', 'ready', 'implement', 'Plan ready'],
    ['plan', 'blocked', 'failed', 'Planning blocked'],
    ['implement', 'implemented', 'verify', 'Implementation committed'],
    ['implement', 'blocked', 'failed', 'Implementation blocked'],
    ['verify', 'passed', 'requirements-review', 'Verification passed'],
    ['verify', 'failed-checks', 'fix-findings', 'Checks failed'],
    ['requirements-review', 'reviewed', 'security-review', 'Requirements reviewed'],
    ['requirements-review', 'blocked', 'failed', 'Requirements review blocked'],
    ['security-review', 'reviewed', 'simplification-review', 'Security reviewed'],
    ['security-review', 'blocked', 'failed', 'Security review blocked'],
    ['simplification-review', 'reviewed', 'aggregate-review', 'Simplification reviewed'],
    ['simplification-review', 'blocked', 'failed', 'Simplification review blocked'],
    ['aggregate-review', 'changes-required', 'fix-findings', 'Changes required'],
    ['aggregate-review', 'clean', 'finalize-delivery', 'Review clean'],
    ['fix-findings', 'fixed', 'verify', 'Findings fixed'],
    ['fix-findings', 'blocked', 'failed', 'Fixes blocked'],
    ['finalize-delivery', 'delivered', 'succeeded', 'Delivery finalized'],
  ].map(([sourceNodeId, outcome, targetNodeId, label]) => ({
    sourceNodeId,
    outcome,
    targetNodeId,
    label,
  }))

  const revision = WorkflowRevisionSchema.parse({
    workflowId: PREDEFINED_V1_WORKFLOW_ID,
    revisionId: input.revisionId,
    name: 'Software delivery workflow',
    description:
      'Deliver one approved ClickUp task through planning, implementation, verification, review, and GitLab finalization.',
    startNodeId: 'load-clickup-task',
    nodes,
    edges,
    maxTransitions: PREDEFINED_V1_TRANSITION_LIMIT,
    createdAt: input.createdAt,
  })
  const validation = validateWorkflow(revision, {
    registeredCommandIds: new Set(PREDEFINED_V1_COMMAND_IDS),
  })
  if (!validation.valid) {
    throw new Error('The source-controlled V1 workflow is invalid.')
  }
  return validation.workflow
}

export function deriveDeliveryWorkflowTestRevision(
  parent: WorkflowRevision,
  input: DerivePredefinedV1RevisionInput,
): WorkflowRevision {
  const updates = new Map(input.updates.map((update) => [update.nodeId, update.changes]))
  const revision = WorkflowRevisionSchema.parse({
    ...parent,
    revisionId: input.revisionId,
    parentRevisionId: parent.revisionId,
    createdAt: input.createdAt,
    nodes: parent.nodes.map((node) => {
      const changes = updates.get(node.id)
      if (changes === undefined || node.type !== 'agent') return node
      return {
        ...node,
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.timeoutSeconds === undefined ? {} : { timeoutSeconds: changes.timeoutSeconds }),
        result: {
          ...node.result,
          ...(changes.outputSchemaRef === undefined ? {} : { schemaRef: changes.outputSchemaRef }),
        },
        job: {
          ...node.job,
          ...(changes.prompt === undefined ? {} : { prompt: changes.prompt }),
          ...(changes.skillSnapshotRefs === undefined
            ? {}
            : { skillSnapshotRefs: changes.skillSnapshotRefs }),
          ...(changes.connectorIds === undefined ? {} : { connectorIds: changes.connectorIds }),
          inference: {
            ...node.job.inference,
            ...(changes.connectionId === undefined ? {} : { connectionId: changes.connectionId }),
            ...(changes.modelId === undefined ? {} : { modelId: changes.modelId }),
            ...(changes.thinkingLevel === undefined
              ? {}
              : { thinkingLevel: changes.thinkingLevel }),
          },
        },
      }
    }),
  })
  const validation = validateWorkflow(revision, {
    registeredCommandIds: new Set(PREDEFINED_V1_COMMAND_IDS),
  })
  if (!validation.valid) throw new Error('The delivery test workflow revision is invalid.')
  return validation.workflow
}
