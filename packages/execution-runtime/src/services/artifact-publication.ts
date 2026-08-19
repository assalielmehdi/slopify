import {
  ArtifactIdSchema,
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

import type { JsonValue } from '../persistence/json.js'
import type {
  PersistedArtifact,
  RecordArtifactInput,
  RunRepository,
} from '../persistence/run-repository.js'

export interface ConnectorArtifactEnvelope {
  readonly runId: RunId
  readonly workflowId: WorkflowId
  readonly revisionId: RevisionId
  readonly nodeId: NodeId
  readonly artifactType: ArtifactType
  readonly producer: string
  readonly status: ArtifactStatus
}

export interface ConnectorArtifact {
  readonly taskId: string
  readonly commentId: string
  readonly author: string
  readonly createdAt: string
  readonly envelope: ConnectorArtifactEnvelope
  readonly content: string
}

export interface ConnectorPublishArtifactInput extends ConnectorArtifactEnvelope {
  readonly taskId: string
  readonly content: string
}

export interface ConnectorArtifactReference {
  readonly taskId: string
  readonly runId: RunId
  readonly artifactType: ArtifactType
}

export type ArtifactStatus = 'changes-requested' | 'completed' | 'resolved'

export interface ConnectorUpdateReviewSummaryInput {
  readonly taskId: string
  readonly runId: RunId
  readonly commentId: string
  readonly status: 'changes-requested' | 'resolved'
  readonly appendContent: string
}

export interface ArtifactConnector {
  publishArtifact(input: ConnectorPublishArtifactInput): Promise<ConnectorArtifact>
  getArtifact(input: ConnectorArtifactReference): Promise<ConnectorArtifact>
  updateReviewSummary?(input: ConnectorUpdateReviewSummaryInput): Promise<ConnectorArtifact>
}

export interface DurableArtifactReference {
  readonly artifactId: ReturnType<typeof ArtifactIdSchema.parse>
  readonly runId: RunId
  readonly artifactType: ArtifactType
  readonly content: string
  readonly commentId: string
  readonly status: ArtifactStatus
}

export type ArtifactPublicationErrorCode =
  | 'ARTIFACT_INPUT_INVALID'
  | 'ARTIFACT_LOCAL_AMBIGUOUS'
  | 'ARTIFACT_LOCAL_MISSING'
  | 'ARTIFACT_PUBLICATION_FAILED'
  | 'ARTIFACT_READBACK_MISMATCH'

const messages: Readonly<Record<ArtifactPublicationErrorCode, string>> = {
  ARTIFACT_INPUT_INVALID: 'Artifact publication input is invalid',
  ARTIFACT_LOCAL_AMBIGUOUS: 'More than one local artifact matches the exact reference',
  ARTIFACT_LOCAL_MISSING: 'The exact local artifact is unavailable',
  ARTIFACT_PUBLICATION_FAILED: 'Artifact publication failed',
  ARTIFACT_READBACK_MISMATCH: 'Artifact readback does not match local evidence',
}

export class ArtifactPublicationError extends Error {
  override readonly name = 'ArtifactPublicationError'

  constructor(readonly code: ArtifactPublicationErrorCode) {
    super(messages[code])
  }
}

export interface PublishAgentArtifactInput {
  readonly taskId: string
  readonly runId: RunId
  readonly workflowId: WorkflowId
  readonly revisionId: RevisionId
  readonly nodeId: NodeId
  readonly nodeExecutionId: string
  readonly artifactType: ArtifactType
  readonly title: string
  readonly content: string
  readonly status?: 'completed' | 'changes-requested'
}

export interface LoadExactArtifactInput {
  readonly taskId: string
  readonly runId: RunId
  readonly workflowId: WorkflowId
  readonly revisionId: RevisionId
  readonly nodeId: NodeId
  readonly artifactType: ArtifactType
  readonly acceptedStatuses?: readonly ArtifactStatus[]
}

export interface UpdateReviewSummaryInput {
  readonly taskId: string
  readonly runId: RunId
  readonly workflowId: WorkflowId
  readonly revisionId: RevisionId
  readonly nodeId: NodeId
  readonly nodeExecutionId: string
  readonly status: 'changes-requested' | 'resolved'
  readonly appendContent: string
}

export interface ArtifactPublicationService {
  publish(input: PublishAgentArtifactInput): Promise<DurableArtifactReference>
  loadExact(input: LoadExactArtifactInput): Promise<DurableArtifactReference>
  updateReviewSummary(input: UpdateReviewSummaryInput): Promise<DurableArtifactReference>
}

export interface CreateArtifactPublicationServiceOptions {
  readonly connector: ArtifactConnector
  readonly runs: Pick<RunRepository, 'listArtifacts' | 'recordArtifact' | 'updateArtifact'>
  readonly producer: string
  readonly createArtifactId?: () => string
  readonly now?: () => string
}

const taskIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+$/i)
const producerSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^(?:pi-sdk@(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)|aggregate-review-findings)$/)
const contentSchema = z
  .string()
  .min(1)
  .max(1_000_000)
  .refine((value) => value.trim().length > 0)
const identitySchema = z.string().trim().min(1).max(512)
const artifactStatusSchema = z.enum(['changes-requested', 'completed', 'resolved'])

const metadataSchema = z.strictObject({
  source: z.literal('clickup-comment'),
  taskId: taskIdSchema,
  commentId: identitySchema,
  author: identitySchema,
  createdAt: z.iso.datetime({ offset: true }),
  title: z.string().trim().min(1).max(512),
  producer: producerSchema,
  status: artifactStatusSchema.default('completed'),
})

const validateInput = (input: PublishAgentArtifactInput): void => {
  const parsed = z
    .strictObject({
      taskId: taskIdSchema,
      runId: RunIdSchema,
      workflowId: WorkflowIdSchema,
      revisionId: RevisionIdSchema,
      artifactType: ArtifactTypeSchema,
      nodeId: NodeIdSchema,
      nodeExecutionId: identitySchema,
      title: z.string().trim().min(1).max(512),
      content: contentSchema,
      status: z.enum(['completed', 'changes-requested']).optional(),
    })
    .safeParse(input)
  if (!parsed.success) throw new ArtifactPublicationError('ARTIFACT_INPUT_INVALID')
  if (input.status === 'changes-requested' && input.artifactType !== 'REVIEW_SUMMARY') {
    throw new ArtifactPublicationError('ARTIFACT_INPUT_INVALID')
  }
}

const matchesEnvelope = (
  artifact: ConnectorArtifact,
  expected: Readonly<{
    taskId: string
    runId: RunId
    workflowId: WorkflowId
    revisionId: RevisionId
    nodeId: NodeId
    artifactType: ArtifactType
    producer: string
    acceptedStatuses: readonly ArtifactStatus[]
  }>,
): boolean =>
  artifact.taskId === expected.taskId &&
  artifact.envelope.runId === expected.runId &&
  artifact.envelope.workflowId === expected.workflowId &&
  artifact.envelope.revisionId === expected.revisionId &&
  artifact.envelope.nodeId === expected.nodeId &&
  artifact.envelope.artifactType === expected.artifactType &&
  artifact.envelope.producer === expected.producer &&
  expected.acceptedStatuses.includes(artifact.envelope.status)

export const createArtifactPublicationService = (
  options: CreateArtifactPublicationServiceOptions,
): ArtifactPublicationService => {
  const producer = producerSchema.safeParse(options.producer)
  if (!producer.success) throw new ArtifactPublicationError('ARTIFACT_INPUT_INVALID')
  const createArtifactId = options.createArtifactId ?? (() => `artifact-${crypto.randomUUID()}`)
  const now = options.now ?? (() => new Date().toISOString())

  return {
    async publish(input) {
      validateInput(input)
      const status = input.status ?? 'completed'
      let remote: ConnectorArtifact
      try {
        remote = await options.connector.publishArtifact({
          taskId: input.taskId,
          runId: input.runId,
          workflowId: input.workflowId,
          revisionId: input.revisionId,
          nodeId: input.nodeId,
          artifactType: input.artifactType,
          producer: producer.data,
          status,
          content: input.content,
        })
      } catch {
        throw new ArtifactPublicationError('ARTIFACT_PUBLICATION_FAILED')
      }
      if (
        !matchesEnvelope(remote, {
          ...input,
          producer: producer.data,
          acceptedStatuses: [status],
        }) ||
        remote.content.trim() === '' ||
        remote.content.length > 1_000_000
      ) {
        throw new ArtifactPublicationError('ARTIFACT_READBACK_MISMATCH')
      }
      const artifactId = ArtifactIdSchema.parse(createArtifactId())
      const metadata = metadataSchema.parse({
        source: 'clickup-comment',
        taskId: input.taskId,
        commentId: remote.commentId,
        author: remote.author,
        createdAt: remote.createdAt,
        title: input.title,
        producer: producer.data,
        status: remote.envelope.status,
      })
      const record: RecordArtifactInput = {
        artifactId,
        runId: input.runId,
        nodeExecutionId: input.nodeExecutionId,
        nodeId: input.nodeId,
        artifactType: input.artifactType,
        content: remote.content,
        metadata: metadata as JsonValue,
        timestamp: now(),
      }
      options.runs.recordArtifact(record)
      return {
        artifactId,
        runId: input.runId,
        artifactType: input.artifactType,
        content: remote.content,
        commentId: remote.commentId,
        status: remote.envelope.status,
      }
    },

    async loadExact(input) {
      const taskId = taskIdSchema.safeParse(input.taskId)
      if (!taskId.success) throw new ArtifactPublicationError('ARTIFACT_INPUT_INVALID')
      const matches = options.runs
        .listArtifacts(input.runId)
        .filter(({ artifactType }) => artifactType === input.artifactType)
      if (matches.length === 0) throw new ArtifactPublicationError('ARTIFACT_LOCAL_MISSING')
      if (matches.length !== 1) throw new ArtifactPublicationError('ARTIFACT_LOCAL_AMBIGUOUS')
      const local = matches[0] as PersistedArtifact
      const metadata = metadataSchema.safeParse(local.metadata)
      if (!metadata.success || metadata.data.taskId !== taskId.data) {
        throw new ArtifactPublicationError('ARTIFACT_READBACK_MISMATCH')
      }
      let remote: ConnectorArtifact
      try {
        remote = await options.connector.getArtifact({
          taskId: taskId.data,
          runId: input.runId,
          artifactType: input.artifactType,
        })
      } catch {
        throw new ArtifactPublicationError('ARTIFACT_PUBLICATION_FAILED')
      }
      if (
        !matchesEnvelope(remote, {
          ...input,
          taskId: taskId.data,
          producer: producer.data,
          acceptedStatuses: input.acceptedStatuses ?? ['completed'],
        }) ||
        remote.commentId !== metadata.data.commentId ||
        remote.envelope.status !== metadata.data.status ||
        remote.content !== local.content
      ) {
        throw new ArtifactPublicationError('ARTIFACT_READBACK_MISMATCH')
      }
      return {
        artifactId: local.artifactId,
        runId: input.runId,
        artifactType: local.artifactType,
        content: local.content,
        commentId: metadata.data.commentId,
        status: metadata.data.status,
      }
    },

    async updateReviewSummary(input) {
      const parsed = z
        .strictObject({
          taskId: taskIdSchema,
          runId: RunIdSchema,
          workflowId: WorkflowIdSchema,
          revisionId: RevisionIdSchema,
          nodeId: NodeIdSchema,
          nodeExecutionId: identitySchema,
          status: z.enum(['changes-requested', 'resolved']),
          appendContent: contentSchema,
        })
        .safeParse(input)
      if (!parsed.success || options.connector.updateReviewSummary === undefined) {
        throw new ArtifactPublicationError('ARTIFACT_INPUT_INVALID')
      }
      const matches = options.runs
        .listArtifacts(parsed.data.runId)
        .filter(({ artifactType }) => artifactType === 'REVIEW_SUMMARY')
      if (matches.length === 0) throw new ArtifactPublicationError('ARTIFACT_LOCAL_MISSING')
      if (matches.length !== 1) throw new ArtifactPublicationError('ARTIFACT_LOCAL_AMBIGUOUS')
      const local = matches[0] as PersistedArtifact
      const metadata = metadataSchema.safeParse(local.metadata)
      if (
        !metadata.success ||
        metadata.data.taskId !== parsed.data.taskId ||
        metadata.data.producer !== producer.data ||
        metadata.data.status === 'completed'
      ) {
        throw new ArtifactPublicationError('ARTIFACT_READBACK_MISMATCH')
      }
      let current: ConnectorArtifact
      try {
        current = await options.connector.getArtifact({
          taskId: parsed.data.taskId,
          runId: parsed.data.runId,
          artifactType: 'REVIEW_SUMMARY',
        })
      } catch {
        throw new ArtifactPublicationError('ARTIFACT_PUBLICATION_FAILED')
      }
      if (
        !matchesEnvelope(current, {
          taskId: parsed.data.taskId,
          runId: parsed.data.runId,
          workflowId: parsed.data.workflowId,
          revisionId: parsed.data.revisionId,
          nodeId: parsed.data.nodeId,
          artifactType: 'REVIEW_SUMMARY',
          producer: producer.data,
          acceptedStatuses: ['changes-requested', 'resolved'],
        }) ||
        current.commentId !== metadata.data.commentId ||
        current.envelope.status !== metadata.data.status ||
        current.content !== local.content
      ) {
        throw new ArtifactPublicationError('ARTIFACT_READBACK_MISMATCH')
      }
      let remote: ConnectorArtifact
      try {
        remote = await options.connector.updateReviewSummary({
          taskId: parsed.data.taskId,
          runId: parsed.data.runId,
          commentId: metadata.data.commentId,
          status: parsed.data.status,
          appendContent: parsed.data.appendContent,
        })
      } catch {
        throw new ArtifactPublicationError('ARTIFACT_PUBLICATION_FAILED')
      }
      if (
        !matchesEnvelope(remote, {
          taskId: parsed.data.taskId,
          runId: parsed.data.runId,
          workflowId: parsed.data.workflowId,
          revisionId: parsed.data.revisionId,
          nodeId: parsed.data.nodeId,
          artifactType: 'REVIEW_SUMMARY',
          producer: producer.data,
          acceptedStatuses: [parsed.data.status],
        }) ||
        remote.commentId !== metadata.data.commentId ||
        !remote.content.startsWith(`${local.content}\n\n---\n\n`) ||
        remote.content.length > 1_000_000
      ) {
        throw new ArtifactPublicationError('ARTIFACT_READBACK_MISMATCH')
      }
      const updatedMetadata = metadataSchema.parse({
        ...metadata.data,
        author: remote.author,
        createdAt: remote.createdAt,
        status: remote.envelope.status,
      })
      try {
        options.runs.updateArtifact({
          artifactId: local.artifactId,
          runId: parsed.data.runId,
          nodeExecutionId: parsed.data.nodeExecutionId,
          nodeId: parsed.data.nodeId,
          artifactType: 'REVIEW_SUMMARY',
          content: remote.content,
          metadata: updatedMetadata as JsonValue,
          timestamp: now(),
        })
      } catch {
        throw new ArtifactPublicationError('ARTIFACT_PUBLICATION_FAILED')
      }
      return {
        artifactId: local.artifactId,
        runId: parsed.data.runId,
        artifactType: 'REVIEW_SUMMARY',
        content: remote.content,
        commentId: remote.commentId,
        status: remote.envelope.status,
      }
    },
  }
}
