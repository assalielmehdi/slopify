import { describe, expect, it } from 'vitest'

import { createExecutorRegistry, type NodeExecutor } from '../../src/index.js'
import { createDeliveryWorkflowTestRevision } from '../fixtures/delivery-workflow.js'

const executor = (): NodeExecutor => ({ execute: async () => undefined })

describe('executor registry', () => {
  it('routes named agent nodes before the generic agent fallback', () => {
    const selection = executor()
    const plan = executor()
    const implementation = executor()
    const workflow = createDeliveryWorkflowTestRevision({
      revisionId: 'revision-0001',
      createdAt: '2026-08-19T11:00:00Z',
      agentDefaults: { provider: 'pi-sdk', model: 'test-model', thinkingLevel: 'high' },
    })
    const nodes = new Map(workflow.nodes.map((node) => [node.id, node]))
    const registry = createExecutorRegistry({
      commands: {},
      agent: selection,
      agents: { plan, implement: implementation },
    })

    const selectionNode = nodes.get('select-repositories')
    const planNode = nodes.get('plan')
    const implementationNode = nodes.get('implement')
    if (selectionNode === undefined || planNode === undefined || implementationNode === undefined) {
      throw new Error('Predefined workflow is missing delivery agent nodes')
    }

    expect(registry.resolve(selectionNode)).toBe(selection)
    expect(registry.resolve(planNode)).toBe(plan)
    expect(registry.resolve(implementationNode)).toBe(implementation)
  })
})
