import { WorkflowSchema } from './schemas.js'
import type { Workflow } from './types.js'
import { validateWorkflow } from './validate-workflow.js'

export const PREDEFINED_V1_WORKFLOW_ID = 'delivery-workflow'
export const PREDEFINED_V1_TRANSITION_LIMIT = 0
export const PREDEFINED_V1_COMMAND_IDS = Object.freeze([] as string[])

export interface PredefinedV1AgentDefaults {
  readonly provider: string
  readonly model: string
  readonly thinkingLevel: string
}

export interface CreatePredefinedV1WorkflowInput {
  readonly createdAt: string
  readonly agentDefaults: PredefinedV1AgentDefaults
}

export function createPredefinedV1Workflow(input: CreatePredefinedV1WorkflowInput): Workflow {
  const workflow = WorkflowSchema.parse({
    workflowId: PREDEFINED_V1_WORKFLOW_ID,
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
    ],
    edges: [],
    maxTransitions: PREDEFINED_V1_TRANSITION_LIMIT,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  })
  const validation = validateWorkflow(workflow, {
    registeredCommandIds: new Set(PREDEFINED_V1_COMMAND_IDS),
  })
  if (!validation.valid) throw new Error('The source-controlled V1 workflow is invalid.')
  return validation.workflow
}
