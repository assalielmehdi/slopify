import { WorkflowRevisionSchema } from './schemas.js'
import type { WorkflowRevision } from './types.js'
import { validateWorkflow } from './validate-workflow.js'

export const PREDEFINED_V1_WORKFLOW_ID = 'delivery-workflow'
export const PREDEFINED_V1_TRANSITION_LIMIT = 2
export const PREDEFINED_V1_COMMAND_IDS = Object.freeze([] as string[])

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

export function createPredefinedV1Revision(
  input: CreatePredefinedV1RevisionInput,
): WorkflowRevision {
  const revision = WorkflowRevisionSchema.parse({
    workflowId: PREDEFINED_V1_WORKFLOW_ID,
    revisionId: input.revisionId,
    name: 'Who are you?',
    description: 'Run one agent and ask it to identify itself.',
    startNodeId: 'identify-agent',
    nodes: [
      {
        type: 'agent',
        id: 'identify-agent',
        name: 'Who are you?',
        description: 'Ask the agent to identify itself.',
        timeoutSeconds: 300,
        result: { schemaRef: 'json:any-v1' },
        sandbox: { profileId: 'agent-default-v1', imageId: 'gondolin-alpine-v1' },
        job: {
          kind: 'agent',
          prompt: "Who are you? What's your name?",
          skillSnapshotRefs: [],
          inference: {
            connectionId: `${input.agentDefaults.provider}-default`,
            modelId: input.agentDefaults.model,
            thinkingLevel: input.agentDefaults.thinkingLevel,
          },
          connectorIds: [],
        },
      },
      { type: 'terminal', id: 'succeeded', name: 'Succeeded', terminalStatus: 'SUCCEEDED' },
    ],
    edges: [
      {
        sourceNodeId: 'identify-agent',
        outcome: 'completed',
        targetNodeId: 'succeeded',
        label: 'Answered',
      },
    ],
    maxTransitions: PREDEFINED_V1_TRANSITION_LIMIT,
    createdAt: input.createdAt,
  })
  const validation = validateWorkflow(revision, {
    registeredCommandIds: new Set(PREDEFINED_V1_COMMAND_IDS),
  })
  if (!validation.valid) throw new Error('The source-controlled V1 workflow is invalid.')
  return validation.workflow
}
