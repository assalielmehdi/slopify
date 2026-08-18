import { ArtifactTypeSchema, RunIdSchema, type ArtifactType, type RunId } from '@loop/contracts'

import {
  createArtifactEnvelopeCodec,
  type ArtifactEnvelope,
  type ArtifactEnvelopeInput,
  type ArtifactProducerPolicy,
} from './artifact-envelope.js'
import type { ClickUpTaskClient, ClickUpTaskComment } from './client.js'
import {
  ClickUpArtifactError,
  type ClickUpArtifactErrorContext,
  type ClickUpArtifactOperation,
} from './errors.js'
import { containsHiddenReasoning, redactArtifactContent } from './redaction.js'
import { normalizeClickUpTaskReference, type ClickUpTaskId } from './task-reference.js'

export interface ClickUpArtifact {
  readonly taskId: ClickUpTaskId
  readonly commentId: string
  readonly author: string
  readonly createdAt: string
  readonly envelope: ArtifactEnvelope
  readonly content: string
}

export interface ExactArtifactReference {
  readonly taskId: ClickUpTaskId
  readonly runId: RunId
  readonly artifactType: ArtifactType
}

export interface PublishArtifactInput extends ArtifactEnvelopeInput {
  readonly taskId: ClickUpTaskId
}

export type ReviewSummaryUpdateStatus = 'changes-requested' | 'resolved'

export interface UpdateReviewSummaryInput {
  readonly taskId: ClickUpTaskId
  readonly runId: RunId
  readonly commentId: string
  readonly status: ReviewSummaryUpdateStatus
  readonly appendContent: string
}

export interface ClickUpArtifactService {
  listArtifacts(taskId: ClickUpTaskId, runId: RunId): Promise<readonly ClickUpArtifact[]>
  getArtifact(input: ExactArtifactReference): Promise<ClickUpArtifact>
  publishArtifact(input: PublishArtifactInput): Promise<ClickUpArtifact>
  updateReviewSummary(input: UpdateReviewSummaryInput): Promise<ClickUpArtifact>
}

export interface CreateClickUpArtifactServiceOptions {
  readonly client: ClickUpTaskClient
  readonly producerPolicy: ArtifactProducerPolicy
  readonly sensitiveValues?: readonly string[]
  readonly maxCommentBytes?: number
}

const artifactTypeOrder: Readonly<Record<ArtifactType, number>> = {
  EXECUTION_PLAN: 0,
  IMPLEMENTATION_SUMMARY: 1,
  REVIEW_SUMMARY: 2,
  FINALIZATION: 3,
}

const artifactError = (
  code: 'ARTIFACT_AMBIGUOUS' | 'ARTIFACT_INPUT_INVALID' | 'ARTIFACT_NOT_FOUND' | 'COMMENT_REJECTED',
  operation: ClickUpArtifactOperation,
  context?: ClickUpArtifactErrorContext,
) => new ClickUpArtifactError(code, operation, context)

const canonicalTaskId = (input: string, operation: ClickUpArtifactOperation): ClickUpTaskId => {
  try {
    const reference = normalizeClickUpTaskReference(input)
    if (reference.kind !== 'native') throw artifactError('ARTIFACT_INPUT_INVALID', operation)
    return reference.taskId
  } catch (cause) {
    if (cause instanceof ClickUpArtifactError) throw cause
    throw artifactError('ARTIFACT_INPUT_INVALID', operation)
  }
}

const validateRunId = (input: string, operation: ClickUpArtifactOperation): RunId => {
  const parsed = RunIdSchema.safeParse(input)
  if (!parsed.success) throw artifactError('ARTIFACT_INPUT_INVALID', operation)
  return parsed.data
}

const validateArtifactType = (input: string, operation: ClickUpArtifactOperation): ArtifactType => {
  const parsed = ArtifactTypeSchema.safeParse(input)
  if (!parsed.success) throw artifactError('ARTIFACT_INPUT_INVALID', operation)
  return parsed.data
}

const contextFor = (
  taskId: ClickUpTaskId,
  runId: RunId,
  artifactType?: ArtifactType,
): ClickUpArtifactErrorContext =>
  artifactType === undefined ? { taskId, runId } : { taskId, runId, artifactType }

const validCommentId = (commentId: string): boolean =>
  commentId.trim() === commentId && commentId.length > 0 && commentId.length <= 128

export const createClickUpArtifactService = (
  options: CreateClickUpArtifactServiceOptions,
): ClickUpArtifactService => {
  const codec = createArtifactEnvelopeCodec(options.producerPolicy)
  const maxCommentBytes = options.maxCommentBytes ?? 65_536
  const sensitiveValues = options.sensitiveValues ?? []
  if (
    !Number.isSafeInteger(maxCommentBytes) ||
    maxCommentBytes < 1 ||
    maxCommentBytes > 1_000_000 ||
    sensitiveValues.length > 64 ||
    sensitiveValues.some((value) => value.length < 1 || value.length > 4_096)
  ) {
    throw artifactError('ARTIFACT_INPUT_INVALID', 'CONFIGURE_ARTIFACTS')
  }

  const parseArtifacts = (
    taskId: ClickUpTaskId,
    comments: readonly ClickUpTaskComment[],
  ): readonly ClickUpArtifact[] =>
    comments
      .flatMap((comment) => {
        const parsed = codec.parse(comment.text)
        return parsed.status === 'valid'
          ? [
              {
                taskId,
                commentId: comment.commentId,
                author: comment.author,
                createdAt: comment.createdAt,
                envelope: parsed.envelope,
                content: parsed.content,
              },
            ]
          : []
      })
      .toSorted(
        (left, right) =>
          artifactTypeOrder[left.envelope.artifactType] -
            artifactTypeOrder[right.envelope.artifactType] ||
          left.commentId.localeCompare(right.commentId),
      )

  const listValidated = async (
    taskId: ClickUpTaskId,
    runId: RunId,
  ): Promise<readonly ClickUpArtifact[]> =>
    parseArtifacts(taskId, await options.client.listComments(taskId)).filter(
      (artifact) => artifact.envelope.runId === runId,
    )

  return {
    async listArtifacts(taskIdInput, runIdInput) {
      const taskId = canonicalTaskId(taskIdInput, 'LIST_ARTIFACTS')
      const runId = validateRunId(runIdInput, 'LIST_ARTIFACTS')
      return listValidated(taskId, runId)
    },

    async getArtifact(input) {
      const taskId = canonicalTaskId(input.taskId, 'GET_ARTIFACT')
      const runId = validateRunId(input.runId, 'GET_ARTIFACT')
      const artifactType = validateArtifactType(input.artifactType, 'GET_ARTIFACT')
      const matches = (await listValidated(taskId, runId)).filter(
        (artifact) => artifact.envelope.artifactType === artifactType,
      )
      const context = contextFor(taskId, runId, artifactType)
      if (matches.length === 0) throw artifactError('ARTIFACT_NOT_FOUND', 'GET_ARTIFACT', context)
      if (matches.length > 1) {
        throw artifactError('ARTIFACT_AMBIGUOUS', 'GET_ARTIFACT', {
          ...context,
          commentIds: matches.map(({ commentId }) => commentId).toSorted(),
        })
      }
      return matches[0] as ClickUpArtifact
    },

    async publishArtifact(input) {
      const taskId = canonicalTaskId(input.taskId, 'PUBLISH_ARTIFACT')
      const runId = validateRunId(input.runId, 'PUBLISH_ARTIFACT')
      const artifactType = validateArtifactType(input.artifactType, 'PUBLISH_ARTIFACT')
      const context = contextFor(taskId, runId, artifactType)
      const render = (content: string) =>
        codec.render({
          runId,
          workflowId: input.workflowId,
          revisionId: input.revisionId,
          nodeId: input.nodeId,
          artifactType,
          producer: input.producer,
          status: input.status,
          content,
        })
      try {
        render(input.content)
      } catch {
        throw artifactError('ARTIFACT_INPUT_INVALID', 'PUBLISH_ARTIFACT', context)
      }
      if (containsHiddenReasoning(input.content)) {
        throw artifactError('COMMENT_REJECTED', 'PUBLISH_ARTIFACT', context)
      }
      const content = redactArtifactContent(input.content, sensitiveValues)
      const rendered = render(content)
      if (new TextEncoder().encode(rendered).byteLength > maxCommentBytes) {
        throw artifactError('COMMENT_REJECTED', 'PUBLISH_ARTIFACT', context)
      }

      const existing = (await listValidated(taskId, runId)).filter(
        (artifact) => artifact.envelope.artifactType === artifactType,
      )
      if (existing.length > 0) {
        throw artifactError('COMMENT_REJECTED', 'PUBLISH_ARTIFACT', {
          ...context,
          commentIds: existing.map(({ commentId }) => commentId).toSorted(),
        })
      }

      const created = await options.client.createComment({ taskId, content: rendered })
      const comments = await options.client.listComments(taskId)
      const createdComments = comments.filter(({ commentId }) => commentId === created.commentId)
      if (createdComments.length !== 1 || createdComments[0]?.text !== rendered) {
        throw artifactError('COMMENT_REJECTED', 'PUBLISH_ARTIFACT', context)
      }
      const readback = parseArtifacts(taskId, comments).filter(
        (artifact) =>
          artifact.envelope.runId === runId && artifact.envelope.artifactType === artifactType,
      )
      if (readback.length !== 1 || readback[0]?.commentId !== created.commentId) {
        throw artifactError('COMMENT_REJECTED', 'PUBLISH_ARTIFACT', context)
      }
      return readback[0]
    },

    async updateReviewSummary(input) {
      const operation = 'UPDATE_REVIEW_SUMMARY'
      const taskId = canonicalTaskId(input.taskId, operation)
      const runId = validateRunId(input.runId, operation)
      const context = contextFor(taskId, runId, 'REVIEW_SUMMARY')
      if (
        !validCommentId(input.commentId) ||
        (input.status !== 'changes-requested' && input.status !== 'resolved') ||
        typeof input.appendContent !== 'string' ||
        input.appendContent.trim() === '' ||
        input.appendContent.length > 1_000_000
      ) {
        throw artifactError('ARTIFACT_INPUT_INVALID', operation, context)
      }
      if (containsHiddenReasoning(input.appendContent)) {
        throw artifactError('COMMENT_REJECTED', operation, context)
      }

      const matches = (await listValidated(taskId, runId)).filter(
        (artifact) => artifact.envelope.artifactType === 'REVIEW_SUMMARY',
      )
      if (
        matches.length !== 1 ||
        matches[0]?.commentId !== input.commentId ||
        matches[0].envelope.status === 'completed'
      ) {
        throw artifactError('COMMENT_REJECTED', operation, {
          ...context,
          commentIds: matches.map(({ commentId }) => commentId).toSorted(),
        })
      }

      const existing = matches[0]
      const appendContent = redactArtifactContent(input.appendContent, sensitiveValues)
      const content = `${existing.content}\n\n---\n\n${appendContent}`
      let rendered: string
      try {
        rendered = codec.render({
          ...existing.envelope,
          status: input.status,
          content,
        })
      } catch {
        throw artifactError('ARTIFACT_INPUT_INVALID', operation, context)
      }
      if (new TextEncoder().encode(rendered).byteLength > maxCommentBytes) {
        throw artifactError('COMMENT_REJECTED', operation, context)
      }

      await options.client.updateComment({ commentId: input.commentId, content: rendered })
      const comments = await options.client.listComments(taskId)
      const updatedComments = comments.filter(({ commentId }) => commentId === input.commentId)
      if (updatedComments.length !== 1 || updatedComments[0]?.text !== rendered) {
        throw artifactError('COMMENT_REJECTED', operation, context)
      }
      const readback = parseArtifacts(taskId, comments).filter(
        (artifact) =>
          artifact.envelope.runId === runId && artifact.envelope.artifactType === 'REVIEW_SUMMARY',
      )
      if (readback.length !== 1 || readback[0]?.commentId !== input.commentId) {
        throw artifactError('COMMENT_REJECTED', operation, context)
      }
      return readback[0]
    },
  }
}
