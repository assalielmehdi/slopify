import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  AgentNodeSchema,
  CommandNodeSchema,
  RouterNodeSchema,
  TerminalNodeSchema,
  WorkflowEdgeSchema,
  WorkflowNodeSchema,
  WorkflowSchema,
  type WorkflowNode,
  type Workflow,
} from '../src/index.js'

const agentNode = {
  type: 'agent',
  id: 'plan',
  name: 'Plan',
  description: 'Produce the approved execution plan.',
  timeoutSeconds: 900,
  result: { schemaRef: 'workflow-output/plan-v1' },
  sandbox: { profileId: 'agent-default-v1', imageId: 'gondolin-alpine-v1' },
  job: {
    kind: 'agent',
    prompt: 'Create an execution plan for the task.',
    skillSnapshotRefs: [],
    inference: {
      connectionId: 'openrouter-primary',
      modelId: 'anthropic/claude-sonnet-4.5',
      thinkingLevel: 'high',
    },
    connectorIds: [],
  },
}

const commandNode = {
  type: 'command',
  id: 'verify',
  name: 'Verify',
  description: 'Run configured repository checks.',
  commandId: 'verify-selected-repositories',
  outcomes: ['passed', 'failed-checks'],
  timeoutSeconds: 1_800,
}

const routerNode = {
  type: 'router',
  id: 'aggregate-review',
  name: 'Aggregate review',
  description: 'Route the normalized review result.',
  inputField: 'reviewSummary.result',
  outcomes: ['clean', 'changes-required'],
}

const terminalNode = {
  type: 'terminal',
  id: 'succeeded',
  name: 'Succeeded',
  terminalStatus: 'SUCCEEDED',
}

const workflow = {
  workflowId: 'delivery-workflow',
  name: 'Delivery workflow',
  description: 'Deliver one approved ClickUp task.',
  startNodeId: 'plan',
  nodes: [agentNode, commandNode, routerNode, terminalNode],
  edges: [
    {
      sourceNodeId: 'plan',
      outcome: 'ready',
      targetNodeId: 'verify',
      label: 'Plan ready',
    },
  ],
  maxTransitions: 24,
  createdAt: '2026-08-18T20:00:00Z',
  updatedAt: '2026-08-18T21:00:00Z',
}

describe('workflow node contracts', () => {
  it.each([
    ['agent', AgentNodeSchema, agentNode],
    ['command', CommandNodeSchema, commandNode],
    ['router', RouterNodeSchema, routerNode],
    ['terminal', TerminalNodeSchema, terminalNode],
  ] as const)('parses the %s variant through the public union', (_name, schema, node) => {
    expect(schema.parse(node)).toEqual(node)
    expect(WorkflowNodeSchema.parse(node)).toEqual(node)
  })

  it('exposes an exhaustive four-variant discriminated union', () => {
    const labelFor = (node: WorkflowNode): string => {
      switch (node.type) {
        case 'agent':
          return node.job.inference.connectionId
        case 'command':
          return node.commandId
        case 'router':
          return node.inputField
        case 'terminal':
          return node.terminalStatus
        default: {
          const exhaustive: never = node
          return exhaustive
        }
      }
    }

    expect(labelFor(WorkflowNodeSchema.parse(agentNode))).toBe('openrouter-primary')
    expect(WorkflowNodeSchema.safeParse({ ...agentNode, type: 'human' }).success).toBe(false)
  })

  it.each(['Plan_Node', 'plan node', 'plan_node', '-plan'])(
    'rejects non-kebab node ID %j',
    (id) => {
      expect(WorkflowNodeSchema.safeParse({ ...agentNode, id }).success).toBe(false)
    },
  )

  it.each(['READY', 'ready now', 'ready_now', 'ready-'])(
    'rejects non-kebab outcome %j',
    (outcome) => {
      expect(WorkflowNodeSchema.safeParse({ ...commandNode, outcomes: [outcome] }).success).toBe(
        false,
      )
    },
  )

  it('requires the agent prompt and rejects a configurable harness', () => {
    expect(
      AgentNodeSchema.safeParse({ ...agentNode, job: { ...agentNode.job, prompt: ' ' } }).success,
    ).toBe(false)
    expect(AgentNodeSchema.safeParse({ ...agentNode, harness: 'external-cli' }).success).toBe(false)
  })

  it('requires outcomes for every non-terminal variant', () => {
    expect(CommandNodeSchema.safeParse({ ...commandNode, outcomes: [] }).success).toBe(false)
    expect(RouterNodeSchema.safeParse({ ...routerNode, outcomes: [] }).success).toBe(false)
  })

  it('keeps terminal statuses closed and terminal documents strict', () => {
    expect(
      TerminalNodeSchema.safeParse({ ...terminalNode, terminalStatus: 'COMPLETED' }).success,
    ).toBe(false)
    expect(TerminalNodeSchema.safeParse({ ...terminalNode, outcomes: ['done'] }).success).toBe(
      false,
    )
  })
})

describe('workflow contracts', () => {
  it('parses a labeled directed edge', () => {
    expect(WorkflowEdgeSchema.parse(workflow.edges[0])).toEqual(workflow.edges[0])
  })

  it('parses a complete workflow without revision metadata', () => {
    const parsed = WorkflowSchema.parse(workflow)

    expect(parsed).toEqual(workflow)
    expectTypeOf(parsed).toEqualTypeOf<Workflow>()
    expect(WorkflowSchema.safeParse({ ...workflow, revisionId: 'revision-01' }).success).toBe(false)
    expect(WorkflowSchema.safeParse({ ...workflow, parentRevisionId: 'revision-00' }).success).toBe(
      false,
    )
  })

  it('freezes the parsed workflow and its graph records', () => {
    const parsed = WorkflowSchema.parse(workflow)

    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.nodes)).toBe(true)
    expect(Object.isFrozen(parsed.nodes[0])).toBe(true)
    expect(parsed.nodes[0]?.type).toBe('agent')
    if (parsed.nodes[0]?.type === 'agent') {
      expect(Object.isFrozen(parsed.nodes[0].job)).toBe(true)
      expect(Object.isFrozen(parsed.nodes[0].job.skillSnapshotRefs)).toBe(true)
    }
    expect(Object.isFrozen(parsed.edges)).toBe(true)
    expect(Object.isFrozen(parsed.edges[0])).toBe(true)
  })

  it.each([-1, 1.5, Number.POSITIVE_INFINITY])(
    'rejects invalid transition bound %j',
    (maxTransitions) => {
      expect(WorkflowSchema.safeParse({ ...workflow, maxTransitions }).success).toBe(false)
    },
  )

  it('rejects malformed start and edge outcome identifiers', () => {
    expect(WorkflowSchema.safeParse({ ...workflow, startNodeId: 'Plan Node' }).success).toBe(false)
    expect(
      WorkflowEdgeSchema.safeParse({ ...workflow.edges[0], outcome: 'READY_NOW' }).success,
    ).toBe(false)
  })

  it('rejects invalid timestamps and secret-bearing public fields', () => {
    expect(WorkflowSchema.safeParse({ ...workflow, createdAt: 'yesterday' }).success).toBe(false)
    expect(WorkflowSchema.safeParse({ ...workflow, updatedAt: 'tomorrow' }).success).toBe(false)
    expect(WorkflowSchema.safeParse({ ...workflow, apiToken: 'secret' }).success).toBe(false)
  })
})
