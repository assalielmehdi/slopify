import {
  AgentNodeSchema,
  WorkflowSchema,
  createWorkflowDraft,
  type Workflow,
} from '@slopify/workflow-model'

interface AgentWorkflowFixtureInput {
  readonly configuration?: Workflow['configuration']
  readonly createdAt: string
  readonly modelId?: string
  readonly nodeId?: string
  readonly nodeName?: string
  readonly prompt?: string
  readonly thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
  readonly workflowId?: string
}

export const createAgentWorkflowFixture = (input: AgentWorkflowFixtureInput): Workflow => {
  const workflow = createWorkflowDraft({
    workflowId: input.workflowId ?? 'test-workflow',
    description: 'Run one agent and ask it to identify itself.',
    configuration: input.configuration ?? {
      repositoryIds: [],
      primaryRepositoryId: null,
      variables: [],
    },
    createdAt: input.createdAt,
  })
  const node = AgentNodeSchema.parse({
    type: 'agent',
    id: input.nodeId ?? 'identify-agent',
    name: input.nodeName ?? 'Who are you?',
    prompt: input.prompt ?? "Who are you? What's your name?",
    harness: {
      harnessId: 'pi',
      ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
      ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
    },
  })

  return WorkflowSchema.parse({
    ...workflow,
    startNodeId: node.id,
    nodes: [node],
  })
}
