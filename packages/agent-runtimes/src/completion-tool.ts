import { OutcomeNameSchema, type OutcomeName } from '@loop/contracts'
import { z } from 'zod'

import { AgentNodeResultSchema, type AgentNodeResult } from './contract.js'
import { COMPLETE_NODE_PARAMETERS } from './output-schemas.js'

const MAX_COMPLETION_RESULT_BYTES = 262_144

export type CompletionToolErrorCode =
  | 'COMPLETION_CONFIGURATION_INVALID'
  | 'COMPLETION_DATA_INVALID'
  | 'COMPLETION_INPUT_INVALID'
  | 'COMPLETION_LATE'
  | 'COMPLETION_MISSING'
  | 'COMPLETION_OUTCOME_UNDECLARED'
  | 'COMPLETION_REPEATED'
  | 'COMPLETION_RESULT_TOO_LARGE'

const messages: Readonly<Record<CompletionToolErrorCode, string>> = {
  COMPLETION_CONFIGURATION_INVALID: 'Completion tool configuration is invalid',
  COMPLETION_DATA_INVALID: 'Completion data does not match the node output schema',
  COMPLETION_INPUT_INVALID: 'Completion input is invalid',
  COMPLETION_LATE: 'Completion was called after the node closed',
  COMPLETION_MISSING: 'The node closed without a completion result',
  COMPLETION_OUTCOME_UNDECLARED: 'Completion outcome is not declared by the node',
  COMPLETION_REPEATED: 'Completion was called more than once',
  COMPLETION_RESULT_TOO_LARGE: 'Completion result exceeds the size limit',
}

export class CompletionToolError extends Error {
  override readonly name = 'CompletionToolError'

  constructor(readonly code: CompletionToolErrorCode) {
    super(messages[code])
  }
}

export interface CompleteNodeToolResult {
  readonly content: readonly [{ readonly type: 'text'; readonly text: 'Node result accepted' }]
  readonly details: Readonly<{ status: 'accepted' }>
  readonly terminate: true
}

export interface CompleteNodeTool {
  readonly name: 'complete_node'
  readonly label: 'Complete node'
  readonly description: string
  readonly parameters: typeof COMPLETE_NODE_PARAMETERS
  execute(toolCallId: string, input: unknown, signal?: AbortSignal): Promise<CompleteNodeToolResult>
}

export interface CompletionToolController {
  readonly tool: CompleteNodeTool
  finish(): NonNullable<AgentNodeResult>
}

export interface CreateCompletionToolControllerOptions {
  readonly declaredOutcomes: readonly OutcomeName[]
  readonly outputSchema: z.ZodType<unknown>
}

type CompletionState =
  | Readonly<{ kind: 'open' }>
  | Readonly<{ kind: 'completed'; result: NonNullable<AgentNodeResult> }>
  | Readonly<{ kind: 'closed' }>

const parseDeclaredOutcomes = (input: readonly OutcomeName[]): ReadonlySet<OutcomeName> => {
  const parsed = z.array(OutcomeNameSchema).min(1).max(32).safeParse(input)
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) {
    throw new CompletionToolError('COMPLETION_CONFIGURATION_INVALID')
  }
  return new Set(parsed.data)
}

export const createCompletionToolController = (
  options: CreateCompletionToolControllerOptions,
): CompletionToolController => {
  const declaredOutcomes = parseDeclaredOutcomes(options.declaredOutcomes)
  if (typeof options.outputSchema?.safeParse !== 'function') {
    throw new CompletionToolError('COMPLETION_CONFIGURATION_INVALID')
  }
  let state: CompletionState = { kind: 'open' }

  const fail = (code: CompletionToolErrorCode): never => {
    state = { kind: 'closed' }
    throw new CompletionToolError(code)
  }

  const tool: CompleteNodeTool = {
    name: 'complete_node',
    label: 'Complete node',
    description: 'Submit the node result exactly once and end the agent execution.',
    parameters: COMPLETE_NODE_PARAMETERS,
    async execute(_toolCallId, input) {
      if (state.kind === 'completed') fail('COMPLETION_REPEATED')
      if (state.kind === 'closed') throw new CompletionToolError('COMPLETION_LATE')

      const parsed = AgentNodeResultSchema.safeParse(input)
      if (!parsed.success) fail('COMPLETION_INPUT_INVALID')
      const parsedResult =
        parsed.data === undefined ? fail('COMPLETION_INPUT_INVALID') : parsed.data
      if (!declaredOutcomes.has(parsedResult.outcome)) fail('COMPLETION_OUTCOME_UNDECLARED')

      const data = options.outputSchema.safeParse(parsedResult.data)
      if (!data.success) fail('COMPLETION_DATA_INVALID')
      const result = AgentNodeResultSchema.safeParse({ ...parsedResult, data: data.data })
      if (!result.success) fail('COMPLETION_DATA_INVALID')
      const validatedResult =
        result.data === undefined ? fail('COMPLETION_DATA_INVALID') : result.data

      let serialized: string | undefined
      try {
        serialized = JSON.stringify(validatedResult)
      } catch {
        fail('COMPLETION_INPUT_INVALID')
      }
      if (serialized === undefined) fail('COMPLETION_INPUT_INVALID')
      if (new TextEncoder().encode(serialized).byteLength > MAX_COMPLETION_RESULT_BYTES) {
        fail('COMPLETION_RESULT_TOO_LARGE')
      }

      state = { kind: 'completed', result: validatedResult }
      return {
        content: [{ type: 'text', text: 'Node result accepted' }],
        details: { status: 'accepted' },
        terminate: true,
      }
    },
  }

  return {
    tool,
    finish() {
      if (state.kind === 'completed') {
        const result = state.result
        state = { kind: 'closed' }
        return result
      }
      return fail('COMPLETION_MISSING')
    },
  }
}
