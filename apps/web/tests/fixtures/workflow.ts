import {
  AgentNodeSchema,
  WorkflowSchema,
  createDefaultWorkflow,
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
  readonly workflowName?: string
}

export const createAgentWorkflowFixture = (input: AgentWorkflowFixtureInput): Workflow => {
  const workflow = createDefaultWorkflow({ createdAt: input.createdAt })
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
    name: input.workflowName ?? 'Who are you?',
    description: 'Run one agent and ask it to identify itself.',
    ...(input.configuration === undefined ? {} : { configuration: input.configuration }),
    startNodeId: node.id,
    nodes: [node],
  })
}
