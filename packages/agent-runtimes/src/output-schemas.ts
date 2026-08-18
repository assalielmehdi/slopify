import Type from 'typebox'

const nonBlank = { minLength: 1, pattern: '\\S' }

const ArtifactType = Type.Union([
  Type.Literal('EXECUTION_PLAN'),
  Type.Literal('IMPLEMENTATION_SUMMARY'),
  Type.Literal('REVIEW_SUMMARY'),
  Type.Literal('FINALIZATION'),
])

const EvidenceKind = Type.Union([
  Type.Literal('command'),
  Type.Literal('test'),
  Type.Literal('file'),
  Type.Literal('url'),
  Type.Literal('note'),
])

const JsonValue = Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String(),
  Type.Array(Type.Unknown()),
  Type.Record(Type.String(), Type.Unknown()),
])

export const COMPLETE_NODE_PARAMETERS = Type.Object(
  {
    outcome: Type.String({ ...nonBlank, maxLength: 128 }),
    summary: Type.String({ ...nonBlank, maxLength: 4_096 }),
    data: JsonValue,
    artifacts: Type.Array(
      Type.Object(
        {
          type: ArtifactType,
          title: Type.String({ ...nonBlank, maxLength: 512 }),
          content: Type.String({ ...nonBlank, maxLength: 1_000_000 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 32 },
    ),
    evidence: Type.Array(
      Type.Object(
        {
          kind: EvidenceKind,
          value: Type.String({ ...nonBlank, maxLength: 16_384 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 128 },
    ),
  },
  { additionalProperties: false },
)
