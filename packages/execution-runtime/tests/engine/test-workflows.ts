import { WorkflowRevisionSchema, type WorkflowRevision } from '@loop/workflow-model'

import { TEST_REVISION_ID, TEST_TIMESTAMP, TEST_WORKFLOW_ID } from '../persistence/test-fixture.js'

export const createSimpleWorkflow = (): WorkflowRevision =>
  WorkflowRevisionSchema.parse({
    workflowId: TEST_WORKFLOW_ID,
    revisionId: TEST_REVISION_ID,
    name: 'Simple workflow',
    description: 'Routes one executor result to a terminal node.',
    startNodeId: 'start',
    nodes: [
      {
        type: 'command',
        id: 'start',
        name: 'Start',
        description: 'Run the fake command.',
        commandId: 'start-command',
        outcomes: ['done', 'blocked'],
        timeoutSeconds: 1,
      },
      { type: 'terminal', id: 'succeeded', name: 'Succeeded', terminalStatus: 'SUCCEEDED' },
      { type: 'terminal', id: 'failed', name: 'Failed', terminalStatus: 'FAILED' },
    ],
    edges: [
      { sourceNodeId: 'start', outcome: 'done', targetNodeId: 'succeeded', label: 'Done' },
      {
        sourceNodeId: 'start',
        outcome: 'blocked',
        targetNodeId: 'failed',
        label: 'Blocked',
      },
    ],
    maxTransitions: 2,
    createdAt: TEST_TIMESTAMP,
  })

export const createCyclicWorkflow = (): WorkflowRevision =>
  WorkflowRevisionSchema.parse({
    workflowId: TEST_WORKFLOW_ID,
    revisionId: TEST_REVISION_ID,
    name: 'Cyclic workflow',
    description: 'Exercises the transition limit.',
    startNodeId: 'start',
    nodes: [
      {
        type: 'command',
        id: 'start',
        name: 'Start',
        description: 'Enter the bounded loop.',
        commandId: 'start-command',
        outcomes: ['next'],
        timeoutSeconds: 1,
      },
      {
        type: 'command',
        id: 'loop',
        name: 'Loop',
        description: 'Return to the same node.',
        commandId: 'loop-command',
        outcomes: ['retry', 'done'],
        timeoutSeconds: 1,
      },
      { type: 'terminal', id: 'succeeded', name: 'Succeeded', terminalStatus: 'SUCCEEDED' },
    ],
    edges: [
      { sourceNodeId: 'start', outcome: 'next', targetNodeId: 'loop', label: 'Next' },
      { sourceNodeId: 'loop', outcome: 'retry', targetNodeId: 'loop', label: 'Retry' },
      { sourceNodeId: 'loop', outcome: 'done', targetNodeId: 'succeeded', label: 'Done' },
    ],
    maxTransitions: 2,
    createdAt: TEST_TIMESTAMP,
  })
