import Type from 'typebox'

const MAX_RESULT_BYTES = 262_144
const nonBlank = { minLength: 1, pattern: '\\S' }

const JsonValue = Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String(),
  Type.Array(Type.Unknown()),
  Type.Record(Type.String(), Type.Unknown()),
])

const NodeResult = Type.Object(
  {
    outcome: Type.String({ ...nonBlank, maxLength: 128 }),
    summary: Type.String({ ...nonBlank, maxLength: 4_096 }),
    data: JsonValue,
    evidence: Type.Array(
      Type.Object(
        {
          kind: Type.Union([
            Type.Literal('command'),
            Type.Literal('test'),
            Type.Literal('file'),
            Type.Literal('url'),
            Type.Literal('note'),
          ]),
          value: Type.String({ ...nonBlank, maxLength: 16_384 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 128 },
    ),
  },
  { additionalProperties: false },
)

interface CompletionExtensionApi {
  registerTool(tool: {
    readonly name: string
    readonly label: string
    readonly description: string
    readonly promptSnippet: string
    readonly promptGuidelines: readonly string[]
    readonly parameters: unknown
    readonly execute: (
      toolCallId: string,
      parameters: unknown,
    ) => Promise<{
      readonly content: readonly [{ readonly type: 'text'; readonly text: string }]
      readonly details: Readonly<Record<string, unknown>>
      readonly terminate: true
    }>
  }): void
}

export default function slopifyCompletionExtension(pi: CompletionExtensionApi): void {
  let accepted = false

  pi.registerTool({
    name: 'slopify_complete_node',
    label: 'Complete Slopify node',
    description:
      'Submit the structured Slopify node result exactly once after all work is complete.',
    promptSnippet: 'Complete the workflow node with a declared outcome and structured evidence.',
    promptGuidelines: [
      'Call slopify_complete_node exactly once after completing the requested work.',
      'Do not finish the response without calling slopify_complete_node.',
    ],
    parameters: NodeResult,
    async execute(_toolCallId, parameters) {
      if (accepted) throw new Error('The Slopify node result was already submitted.')
      const serialized = JSON.stringify(parameters)
      if (new TextEncoder().encode(serialized).byteLength > MAX_RESULT_BYTES) {
        throw new Error('The Slopify node result is too large.')
      }
      accepted = true
      return {
        content: [{ type: 'text', text: 'Node result accepted' }],
        details: { protocol: 'slopify.node-result', result: parameters },
        terminate: true,
      }
    },
  })
}
