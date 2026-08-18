import { describe, expect, it } from 'vitest'

import {
  ClickUpArtifactError,
  createArtifactEnvelopeCodec,
  type ArtifactEnvelopeInput,
  type ArtifactProducerPolicy,
} from '../src/index.js'

const producerPolicy: ArtifactProducerPolicy = {
  agentProducer: 'pi-sdk@0.52.0',
  commandProducers: ['aggregate-review-findings', 'finalize-gitlab-delivery'],
}

const executionPlan: ArtifactEnvelopeInput = {
  runId: 'run-01',
  workflowId: 'delivery-workflow',
  revisionId: 'revision-01',
  nodeId: 'plan',
  artifactType: 'EXECUTION_PLAN',
  producer: 'pi-sdk@0.52.0',
  status: 'completed',
  content: '# Execution plan\n\n- API first\n- UI second',
}

describe('artifact envelope codec', () => {
  it('renders the documented visible v1 envelope exactly', () => {
    const codec = createArtifactEnvelopeCodec(producerPolicy)

    expect(codec.render(executionPlan)).toBe(`[AI-WORKFLOW v1]
run: run-01
workflow: delivery-workflow@revision-01
node: plan
artifact: EXECUTION_PLAN
producer: pi-sdk@0.52.0
status: completed

---

# Execution plan

- API first
- UI second`)
  })

  it.each([
    ['EXECUTION_PLAN', 'plan', 'pi-sdk@0.52.0', 'completed'],
    ['IMPLEMENTATION_SUMMARY', 'implement', 'pi-sdk@0.52.0', 'completed'],
    ['REVIEW_SUMMARY', 'aggregate-review', 'aggregate-review-findings', 'changes-requested'],
    ['FINALIZATION', 'finalize-delivery', 'finalize-gitlab-delivery', 'completed'],
  ] as const)('round-trips %s with exact identity', (artifactType, nodeId, producer, status) => {
    const codec = createArtifactEnvelopeCodec(producerPolicy)
    const input = {
      ...executionPlan,
      artifactType,
      nodeId,
      producer,
      status,
      content: `# ${artifactType}\n\nMarkdown | stays | readable\n--- | --- | ---`,
    }

    expect(codec.parse(codec.render(input))).toEqual({
      status: 'valid',
      envelope: {
        runId: 'run-01',
        workflowId: 'delivery-workflow',
        revisionId: 'revision-01',
        nodeId,
        artifactType,
        producer,
        status,
      },
      content: input.content,
    })
  })

  it('preserves content whitespace and embedded separators byte-for-byte', () => {
    const codec = createArtifactEnvelopeCodec(producerPolicy)
    const content = '# Review\n\nFirst paragraph.  \n\n---\n\nSecond paragraph.\n'

    const rendered = codec.render({ ...executionPlan, content })

    expect(codec.parse(rendered)).toMatchObject({ status: 'valid', content })
    expect(rendered.endsWith(content)).toBe(true)
  })

  it.each(['changes-requested', 'resolved'] as const)(
    'rejects %s for non-review artifacts',
    (status) => {
      const codec = createArtifactEnvelopeCodec(producerPolicy)

      expect(() => codec.render({ ...executionPlan, status })).toThrowError(
        expect.objectContaining({
          code: 'ARTIFACT_INPUT_INVALID',
          operation: 'RENDER_ARTIFACT',
        }) as ClickUpArtifactError,
      )
    },
  )

  it.each(['completed', 'changes-requested', 'resolved'] as const)(
    'accepts %s for review summaries',
    (status) => {
      const codec = createArtifactEnvelopeCodec(producerPolicy)

      expect(() =>
        codec.render({
          ...executionPlan,
          nodeId: 'aggregate-review',
          artifactType: 'REVIEW_SUMMARY',
          producer: 'aggregate-review-findings',
          status,
        }),
      ).not.toThrow()
    },
  )

  it.each(['pi-sdk@0.51.0', 'unknown-command', 'pi-sdk@latest'])(
    'rejects unapproved producer %s',
    (producer) => {
      const codec = createArtifactEnvelopeCodec(producerPolicy)

      expect(() => codec.render({ ...executionPlan, producer })).toThrowError(
        expect.objectContaining({ code: 'ARTIFACT_INPUT_INVALID' }) as ClickUpArtifactError,
      )
    },
  )

  it.each([
    ['unknown artifact', 'A human comment'],
    ['wrong marker', '[AI-WORKFLOW v2]\nrun: run-01'],
  ])('classifies %s as not an artifact', (_description, comment) => {
    const codec = createArtifactEnvelopeCodec(producerPolicy)

    expect(codec.parse(comment)).toEqual({ status: 'not-artifact' })
  })

  it.each([
    [
      'blank content',
      '[AI-WORKFLOW v1]\nrun: run-01\nworkflow: delivery-workflow@revision-01\nnode: plan\nartifact: EXECUTION_PLAN\nproducer: pi-sdk@0.52.0\nstatus: completed\n\n---\n\n   ',
    ],
    [
      'extra header whitespace',
      '[AI-WORKFLOW v1]\nrun:  run-01\nworkflow: delivery-workflow@revision-01\nnode: plan\nartifact: EXECUTION_PLAN\nproducer: pi-sdk@0.52.0\nstatus: completed\n\n---\n\n# Plan',
    ],
    [
      'reordered headers',
      '[AI-WORKFLOW v1]\nworkflow: delivery-workflow@revision-01\nrun: run-01\nnode: plan\nartifact: EXECUTION_PLAN\nproducer: pi-sdk@0.52.0\nstatus: completed\n\n---\n\n# Plan',
    ],
    [
      'unsupported artifact',
      '[AI-WORKFLOW v1]\nrun: run-01\nworkflow: delivery-workflow@revision-01\nnode: plan\nartifact: RAW_LOG\nproducer: pi-sdk@0.52.0\nstatus: completed\n\n---\n\n# Plan',
    ],
    [
      'unapproved producer',
      '[AI-WORKFLOW v1]\nrun: run-01\nworkflow: delivery-workflow@revision-01\nnode: plan\nartifact: EXECUTION_PLAN\nproducer: other-agent@1.0.0\nstatus: completed\n\n---\n\n# Plan',
    ],
    [
      'CRLF envelope',
      '[AI-WORKFLOW v1]\r\nrun: run-01\r\nworkflow: delivery-workflow@revision-01\r\nnode: plan\r\nartifact: EXECUTION_PLAN\r\nproducer: pi-sdk@0.52.0\r\nstatus: completed\r\n\r\n---\r\n\r\n# Plan',
    ],
  ])('classifies %s as an invalid artifact', (_description, comment) => {
    const codec = createArtifactEnvelopeCodec(producerPolicy)

    expect(codec.parse(comment)).toEqual({ status: 'invalid' })
  })

  it.each([
    { ...producerPolicy, agentProducer: 'other-agent@1.0.0' },
    { ...producerPolicy, commandProducers: ['Not Kebab Case'] },
    {
      ...producerPolicy,
      commandProducers: ['aggregate-review-findings', 'aggregate-review-findings'],
    },
  ])('rejects malformed producer policy without exposing its values', (policy) => {
    expect(() => createArtifactEnvelopeCodec(policy)).toThrowError(
      expect.objectContaining({
        code: 'ARTIFACT_INPUT_INVALID',
        operation: 'CONFIGURE_ARTIFACTS',
        message: 'ClickUp artifact input is invalid',
      }) as ClickUpArtifactError,
    )
  })
})
