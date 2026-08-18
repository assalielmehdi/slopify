import { Check } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  COMPLETE_NODE_PARAMETERS,
  CompletionToolError,
  createCompletionToolController,
} from '../src/index.js'

const validResult = {
  outcome: 'ready',
  summary: 'Prepared the exact implementation plan.',
  data: { kind: 'plan', sections: 3 },
  artifacts: [
    {
      type: 'EXECUTION_PLAN',
      title: 'Execution plan',
      content: '# Plan\n\nThree verified slices.',
    },
  ],
  evidence: [{ kind: 'file', value: 'tasks/plan.md' }],
}

const outputSchema = z.strictObject({
  kind: z.literal('plan'),
  sections: z.number().int().positive(),
})

const createController = () =>
  createCompletionToolController({
    declaredOutcomes: ['ready', 'blocked'],
    outputSchema,
  })

describe('complete_node schema and validation', () => {
  it('publishes a strict TypeBox schema equivalent to the application result contract', () => {
    expect(Check(COMPLETE_NODE_PARAMETERS, validResult)).toBe(true)
    expect(Check(COMPLETE_NODE_PARAMETERS, { ...validResult, extra: true })).toBe(false)
    expect(Check(COMPLETE_NODE_PARAMETERS, { ...validResult, data: undefined })).toBe(false)
    expect(
      Check(COMPLETE_NODE_PARAMETERS, {
        ...validResult,
        artifacts: [{ ...validResult.artifacts[0], type: 'RAW_LOG' }],
      }),
    ).toBe(false)
  })

  it('captures one revalidated result and returns only an acknowledgement to Pi', async () => {
    const controller = createController()

    const toolResult = await controller.tool.execute('tool-call-01', validResult)

    expect(controller.tool).toMatchObject({
      name: 'complete_node',
      label: 'Complete node',
      parameters: COMPLETE_NODE_PARAMETERS,
    })
    expect(toolResult).toEqual({
      content: [{ type: 'text', text: 'Node result accepted' }],
      details: { status: 'accepted' },
      terminate: true,
    })
    expect(controller.finish()).toEqual(validResult)
    expect(toolResult).not.toHaveProperty('result')
  })

  it('rejects an undeclared outcome at the application boundary', async () => {
    const controller = createController()

    await expect(
      controller.tool.execute('tool-call-01', { ...validResult, outcome: 'implemented' }),
    ).rejects.toMatchObject({
      code: 'COMPLETION_OUTCOME_UNDECLARED',
    } satisfies Partial<CompletionToolError>)
  })

  it('rejects data that does not match the node output schema', async () => {
    const controller = createController()

    await expect(
      controller.tool.execute('tool-call-01', {
        ...validResult,
        data: { kind: 'review', sections: 'three' },
      }),
    ).rejects.toMatchObject({
      code: 'COMPLETION_DATA_INVALID',
    } satisfies Partial<CompletionToolError>)
  })

  it.each([
    ['blank summary', { ...validResult, summary: '  ' }],
    ['extra field', { ...validResult, assistantText: 'Use this as the result' }],
    ['unknown evidence', { ...validResult, evidence: [{ kind: 'thinking', value: 'hidden' }] }],
    ['missing data', { ...validResult, data: undefined }],
  ])('rejects malformed input: %s', async (_description, input) => {
    const controller = createController()

    await expect(controller.tool.execute('tool-call-01', input)).rejects.toMatchObject({
      code: 'COMPLETION_INPUT_INVALID',
    } satisfies Partial<CompletionToolError>)
  })

  it('rejects a result whose serialized representation exceeds the fixed limit', async () => {
    const controller = createCompletionToolController({
      declaredOutcomes: ['ready'],
      outputSchema: z.strictObject({
        kind: z.literal('plan'),
        blob: z.string(),
      }),
    })

    await expect(
      controller.tool.execute('tool-call-01', {
        ...validResult,
        data: { kind: 'plan', blob: 'x'.repeat(300_000) },
      }),
    ).rejects.toMatchObject({
      code: 'COMPLETION_RESULT_TOO_LARGE',
    } satisfies Partial<CompletionToolError>)
  })
})

describe('complete_node lifecycle', () => {
  it('fails the node after a repeated call instead of routing the first result', async () => {
    const controller = createController()
    await controller.tool.execute('tool-call-01', validResult)

    await expect(controller.tool.execute('tool-call-02', validResult)).rejects.toMatchObject({
      code: 'COMPLETION_REPEATED',
    } satisfies Partial<CompletionToolError>)
    expect(() => controller.finish()).toThrow(CompletionToolError)
  })

  it('fails on missing completion and rejects a later call', async () => {
    const controller = createController()

    expect(() => controller.finish()).toThrow(
      expect.objectContaining({ code: 'COMPLETION_MISSING' }),
    )
    await expect(controller.tool.execute('tool-call-01', validResult)).rejects.toMatchObject({
      code: 'COMPLETION_LATE',
    } satisfies Partial<CompletionToolError>)
  })

  it('rejects a call after the accepted result has been finalized', async () => {
    const controller = createController()
    await controller.tool.execute('tool-call-01', validResult)
    expect(controller.finish()).toEqual(validResult)

    await expect(controller.tool.execute('tool-call-02', validResult)).rejects.toMatchObject({
      code: 'COMPLETION_LATE',
    } satisfies Partial<CompletionToolError>)
  })

  it('poisons the controller after malformed input so a retry cannot route', async () => {
    const controller = createController()
    await expect(
      controller.tool.execute('tool-call-01', { ...validResult, summary: '' }),
    ).rejects.toMatchObject({ code: 'COMPLETION_INPUT_INVALID' })

    await expect(controller.tool.execute('tool-call-02', validResult)).rejects.toMatchObject({
      code: 'COMPLETION_LATE',
    } satisfies Partial<CompletionToolError>)
    expect(() => controller.finish()).toThrow(CompletionToolError)
  })

  it('never treats free-form assistant text or another tool result as completion', () => {
    const controller = createController()
    const assistantText = 'ready: use this prose as the routing result'
    const otherToolResult = { content: [{ type: 'text', text: 'ready' }] }

    expect(assistantText).toContain('ready')
    expect(otherToolResult.content[0]?.text).toBe('ready')
    expect(() => controller.finish()).toThrow(
      expect.objectContaining({ code: 'COMPLETION_MISSING' }),
    )
  })
})
