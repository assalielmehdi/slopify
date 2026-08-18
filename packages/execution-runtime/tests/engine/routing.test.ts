import { describe, expect, it } from 'vitest'

import {
  EngineError,
  isNodeTransitionAllowed,
  isRunTransitionAllowed,
  parseNodeResult,
  resolveNextEdge,
} from '../../src/index.js'
import { createSimpleWorkflow } from './test-workflows.js'

describe('executor result validation', () => {
  it('accepts only strict JSON-safe discriminated results', () => {
    expect(
      parseNodeResult({
        status: 'succeeded',
        outcome: 'done',
        artifactIds: [],
        output: { ok: true },
      }),
    ).toEqual({
      status: 'succeeded',
      outcome: 'done',
      artifactIds: [],
      output: { ok: true },
    })

    expect(() =>
      parseNodeResult({
        status: 'succeeded',
        outcome: 'done',
        artifactIds: [],
        output: { invalid: undefined },
      }),
    ).toThrowError(expect.objectContaining({ code: 'EXECUTOR_RESULT_INVALID' }))
    expect(() =>
      parseNodeResult({
        status: 'failed',
        code: 'FAKE_FAILURE',
        message: 'failed',
        hiddenReasoning: 'must not pass',
      }),
    ).toThrowError(expect.objectContaining({ code: 'EXECUTOR_RESULT_INVALID' }))
  })
})

describe('graph routing', () => {
  it('resolves exactly one declared edge', () => {
    const workflow = createSimpleWorkflow()
    const node = workflow.nodes[0]
    if (node === undefined || node.type === 'terminal') expect.unreachable()

    expect(resolveNextEdge(workflow, node, 'done')).toMatchObject({
      sourceNodeId: 'start',
      outcome: 'done',
      targetNodeId: 'succeeded',
    })
  })

  it.each([
    {
      name: 'undeclared outcome',
      outcome: 'invented',
      mutate: (workflow: ReturnType<typeof createSimpleWorkflow>) => workflow,
      code: 'OUTCOME_UNDECLARED',
    },
    {
      name: 'missing edge',
      outcome: 'done',
      mutate: (workflow: ReturnType<typeof createSimpleWorkflow>) => ({
        ...workflow,
        edges: workflow.edges.filter((edge) => edge.outcome !== 'done'),
      }),
      code: 'EDGE_MISSING',
    },
    {
      name: 'ambiguous edge',
      outcome: 'done',
      mutate: (workflow: ReturnType<typeof createSimpleWorkflow>) => ({
        ...workflow,
        edges: [...workflow.edges, { ...workflow.edges[0] }],
      }),
      code: 'EDGE_AMBIGUOUS',
    },
  ])('rejects a $name without selecting a target', ({ outcome, mutate, code }) => {
    const workflow = mutate(createSimpleWorkflow())
    const node = workflow.nodes[0]
    if (node === undefined || node.type === 'terminal') expect.unreachable()

    expect(() => resolveNextEdge(workflow, node, outcome)).toThrowError(
      expect.objectContaining({ code }),
    )
  })
})

describe('state transitions', () => {
  const runStatuses = [
    'PENDING',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'INTERRUPTED',
  ] as const
  const legalRunTransitions = new Set([
    'PENDING:RUNNING',
    'PENDING:FAILED',
    'PENDING:CANCELLED',
    'RUNNING:SUCCEEDED',
    'RUNNING:FAILED',
    'RUNNING:CANCELLED',
    'RUNNING:INTERRUPTED',
  ])

  for (const from of runStatuses) {
    for (const to of runStatuses) {
      it(`${legalRunTransitions.has(`${from}:${to}`) ? 'allows' : 'rejects'} ${from} -> ${to}`, () => {
        expect(isRunTransitionAllowed(from, to)).toBe(legalRunTransitions.has(`${from}:${to}`))
      })
    }
  }

  it('permits only the declared node lifecycle transitions', () => {
    expect(isNodeTransitionAllowed('PENDING', 'RUNNING')).toBe(true)
    expect(isNodeTransitionAllowed('PENDING', 'SKIPPED')).toBe(true)
    expect(isNodeTransitionAllowed('RUNNING', 'SUCCEEDED')).toBe(true)
    expect(isNodeTransitionAllowed('RUNNING', 'FAILED')).toBe(true)
    expect(isNodeTransitionAllowed('RUNNING', 'CANCELLED')).toBe(true)
    expect(isNodeTransitionAllowed('SUCCEEDED', 'RUNNING')).toBe(false)
    expect(isNodeTransitionAllowed('PENDING', 'SUCCEEDED')).toBe(false)
  })

  it('uses a stable error class for invalid routing', () => {
    const workflow = createSimpleWorkflow()
    const node = workflow.nodes[0]
    if (node === undefined || node.type === 'terminal') expect.unreachable()

    try {
      resolveNextEdge(workflow, node, 'invalid')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError)
      expect(error).toMatchObject({ code: 'OUTCOME_UNDECLARED' })
    }
  })
})
