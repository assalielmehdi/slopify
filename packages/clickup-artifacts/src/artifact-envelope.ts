import {
  ArtifactTypeSchema,
  NodeIdSchema,
  RevisionIdSchema,
  RunIdSchema,
  WorkflowIdSchema,
  type ArtifactType,
  type NodeId,
  type RevisionId,
  type RunId,
  type WorkflowId,
} from '@loop/contracts'
import { z } from 'zod'

import { ClickUpArtifactError } from './errors.js'

export type ArtifactStatus = 'changes-requested' | 'completed' | 'resolved'

export interface ArtifactProducerPolicy {
  readonly agentProducer: string
  readonly commandProducers: readonly string[]
}

export interface ArtifactEnvelope {
  readonly runId: RunId
  readonly workflowId: WorkflowId
  readonly revisionId: RevisionId
  readonly nodeId: NodeId
  readonly artifactType: ArtifactType
  readonly producer: string
  readonly status: ArtifactStatus
}

export interface ArtifactEnvelopeInput extends ArtifactEnvelope {
  readonly content: string
}

export type ArtifactEnvelopeParseResult =
  | { readonly status: 'not-artifact' }
  | { readonly status: 'invalid' }
  | {
      readonly status: 'valid'
      readonly envelope: ArtifactEnvelope
      readonly content: string
    }

export interface ArtifactEnvelopeCodec {
  render(input: ArtifactEnvelopeInput): string
  parse(comment: string): ArtifactEnvelopeParseResult
}

const MARKER = '[AI-WORKFLOW v1]'
const HEADER_SEPARATOR = '\n\n---\n\n'
const PINNED_PI_PRODUCER =
  /^pi-sdk@(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u

const ArtifactStatusSchema = z.enum(['completed', 'changes-requested', 'resolved'])
const contentSchema = z
  .string()
  .max(1_000_000)
  .refine((content) => content.trim().length > 0)

const producerPolicySchema = z
  .strictObject({
    agentProducer: z.string().max(128).regex(PINNED_PI_PRODUCER),
    commandProducers: z.array(NodeIdSchema).max(64).readonly(),
  })
  .refine((policy) => new Set(policy.commandProducers).size === policy.commandProducers.length)

const artifactError = (operation: 'CONFIGURE_ARTIFACTS' | 'RENDER_ARTIFACT') =>
  new ClickUpArtifactError('ARTIFACT_INPUT_INVALID', operation)

const createInputSchema = (approvedProducers: ReadonlySet<string>) =>
  z
    .strictObject({
      runId: RunIdSchema,
      workflowId: WorkflowIdSchema,
      revisionId: RevisionIdSchema,
      nodeId: NodeIdSchema,
      artifactType: ArtifactTypeSchema,
      producer: z
        .string()
        .max(128)
        .refine((producer) => approvedProducers.has(producer)),
      status: ArtifactStatusSchema,
      content: contentSchema,
    })
    .refine((input) => input.artifactType === 'REVIEW_SUMMARY' || input.status === 'completed')

const renderEnvelope = (input: ArtifactEnvelopeInput): string => `${MARKER}
run: ${input.runId}
workflow: ${input.workflowId}@${input.revisionId}
node: ${input.nodeId}
artifact: ${input.artifactType}
producer: ${input.producer}
status: ${input.status}${HEADER_SEPARATOR}${input.content}`

export const createArtifactEnvelopeCodec = (
  producerPolicy: ArtifactProducerPolicy,
): ArtifactEnvelopeCodec => {
  const parsedPolicy = producerPolicySchema.safeParse(producerPolicy)
  if (!parsedPolicy.success) throw artifactError('CONFIGURE_ARTIFACTS')
  const approvedProducers = new Set([
    parsedPolicy.data.agentProducer,
    ...parsedPolicy.data.commandProducers,
  ])
  const inputSchema = createInputSchema(approvedProducers)

  return {
    render(input) {
      const parsed = inputSchema.safeParse(input)
      if (!parsed.success) throw artifactError('RENDER_ARTIFACT')
      return renderEnvelope(parsed.data)
    },

    parse(comment) {
      if (!comment.startsWith(MARKER)) return { status: 'not-artifact' }
      const separatorIndex = comment.indexOf(HEADER_SEPARATOR)
      if (separatorIndex < 0) return { status: 'invalid' }
      const header = comment.slice(0, separatorIndex)
      const content = comment.slice(separatorIndex + HEADER_SEPARATOR.length)
      const match =
        /^\[AI-WORKFLOW v1\]\nrun: ([^\n]+)\nworkflow: ([^@\n]+)@([^@\n]+)\nnode: ([^\n]+)\nartifact: ([^\n]+)\nproducer: ([^\n]+)\nstatus: ([^\n]+)$/u.exec(
          header,
        )
      if (match === null) return { status: 'invalid' }
      const parsed = inputSchema.safeParse({
        runId: match[1],
        workflowId: match[2],
        revisionId: match[3],
        nodeId: match[4],
        artifactType: match[5],
        producer: match[6],
        status: match[7],
        content,
      })
      if (!parsed.success) return { status: 'invalid' }
      const { content: parsedContent, ...envelope } = parsed.data
      return { status: 'valid', envelope, content: parsedContent }
    },
  }
}
