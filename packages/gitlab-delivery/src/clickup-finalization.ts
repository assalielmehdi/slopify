import {
  ClickUpArtifactError,
  ClickUpClientError,
  normalizeClickUpTaskReference,
  type ClickUpArtifact,
  type ClickUpArtifactService,
  type ClickUpTaskId,
  type ClickUpTaskSnapshot,
} from '@loop/clickup-artifacts'
import {
  FinalizeClickUpInputSchema,
  GitShaSchema,
  NodeIdSchema,
  RepositoryIdSchema,
  RevisionIdSchema,
  RunIdSchema,
  WorkflowIdSchema,
  type FinalizeClickUpInput,
  type FinalizeGitLabInput,
  type MergeRequestEvidence,
  type RunId,
} from '@loop/contracts'
import type { JsonValue } from '@loop/execution-runtime'
import { z } from 'zod'

import type { DeliveryError } from './errors.js'
import type { GitLabFinalizationResult, GitLabFinalizer } from './finalizer.js'

const taskSnapshotSchema = z.looseObject({
  taskId: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(512),
  url: z.url().max(4_096),
})

const runSchema = z.looseObject({
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  revisionId: RevisionIdSchema,
  profileSnapshotId: z.string().trim().min(1).max(128),
  taskSnapshot: taskSnapshotSchema,
  status: z.literal('RUNNING'),
  currentNodeId: z.literal('finalize-delivery'),
})

const selectionSchema = z.looseObject({
  repositoryId: RepositoryIdSchema,
  profilePosition: z.number().int().nonnegative().safe(),
})

const workspaceSchema = selectionSchema.extend({ baseSha: GitShaSchema })

const deliveryEvidenceSchema = selectionSchema.extend({
  status: z.literal('VERIFIED'),
  gitlabProject: z.string().trim().min(1).max(512),
  mergeRequestIid: z.number().int().positive().safe(),
  mergeRequestUrl: z.url().max(4_096),
  sourceBranch: z.string().trim().min(1).max(512),
  targetBranch: z.string().trim().min(1).max(512),
  headSha: GitShaSchema,
})

const profileSchema = z.looseObject({
  clickupInReviewStatusId: z.string().trim().min(1).max(256),
  repositories: z
    .array(
      selectionSchema.extend({
        gitlabProject: z.string().trim().min(1).max(512),
      }),
    )
    .min(1)
    .max(32),
})

const finalizationNodeId = NodeIdSchema.parse('finalize-delivery')

export interface ClickUpFinalizationRunStore {
  get(runId: RunId): unknown
  listSelections(runId: RunId): readonly unknown[]
  listWorkspaces(runId: RunId): readonly unknown[]
  listDeliveryEvidence(runId: RunId): readonly unknown[]
}

export interface ClickUpFinalizationProfileStore {
  getSnapshot(snapshotId: string): unknown
}

export type ClickUpFinalizationService = Pick<
  ClickUpArtifactService,
  'moveToInReview' | 'publishArtifact'
>

export interface CreateClickUpFinalizerOptions {
  readonly runs: ClickUpFinalizationRunStore
  readonly profiles: ClickUpFinalizationProfileStore
  readonly clickup: ClickUpFinalizationService
}

export type ClickUpFinalizationResult =
  | Readonly<{
      status: 'succeeded'
      mergeRequests: readonly MergeRequestEvidence[]
      artifact: ClickUpArtifact
      task: ClickUpTaskSnapshot
    }>
  | Readonly<{
      status: 'failed'
      error: DeliveryError
      mergeRequests: readonly MergeRequestEvidence[]
      artifact?: ClickUpArtifact
    }>

export interface ClickUpFinalizer {
  finalize(input: FinalizeClickUpInput): Promise<ClickUpFinalizationResult>
}

export type DeliveryFinalizationResult =
  | Extract<ClickUpFinalizationResult, { status: 'succeeded' }>
  | Readonly<{
      status: 'failed'
      error: DeliveryError
      partialEvidence: readonly MergeRequestEvidence[]
      artifact?: ClickUpArtifact
    }>

export interface DeliveryFinalizer {
  finalize(input: FinalizeGitLabInput, signal?: AbortSignal): Promise<DeliveryFinalizationResult>
}

export interface CreateDeliveryFinalizerOptions {
  readonly gitlab: GitLabFinalizer
  readonly clickup: ClickUpFinalizer
}

const asJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

const externalFailureEvidence = (cause: unknown): JsonValue => {
  if (cause instanceof ClickUpArtifactError) {
    return asJson({
      name: cause.name,
      code: cause.code,
      operation: cause.operation,
      ...(cause.context === undefined ? {} : { context: cause.context }),
    })
  }
  if (cause instanceof ClickUpClientError) {
    return { name: cause.name, code: cause.code, operation: cause.operation }
  }
  return { name: 'UnknownClickUpFailure' }
}

const failed = (
  code: DeliveryError['code'],
  message: string,
  mergeRequests: readonly MergeRequestEvidence[],
  evidence?: JsonValue,
  artifact?: ClickUpArtifact,
): ClickUpFinalizationResult => ({
  status: 'failed',
  error: { code, message, ...(evidence === undefined ? {} : { evidence }) },
  mergeRequests: [...mergeRequests],
  ...(artifact === undefined ? {} : { artifact }),
})

const markdownUrl = (url: string): string =>
  `<${url.replaceAll('<', '%3C').replaceAll('>', '%3E')}>`

const renderClickUpFinalizationArtifact = (
  taskUrl: string,
  mergeRequests: readonly MergeRequestEvidence[],
): string =>
  [
    '# Delivery finalization',
    '',
    `Task: ${markdownUrl(taskUrl)}`,
    '',
    'Every selected repository has one opened merge request verified by exact branch and head identity.',
    '',
    '## Merge requests',
    '',
    ...mergeRequests.flatMap((mergeRequest) => [
      `### ${mergeRequest.repositoryId}`,
      '',
      `- Merge request: ${markdownUrl(mergeRequest.url)}`,
      `- Source branch: ${mergeRequest.sourceBranch}`,
      `- Target branch: ${mergeRequest.targetBranch}`,
      `- Base SHA: \`${mergeRequest.baseSha}\``,
      `- Head SHA: \`${mergeRequest.headSha}\``,
      '',
    ]),
  ]
    .join('\n')
    .trim()

const sameEvidence = (
  mergeRequest: MergeRequestEvidence,
  selection: z.output<typeof selectionSchema>,
  workspace: z.output<typeof workspaceSchema>,
  delivery: z.output<typeof deliveryEvidenceSchema>,
  profileRepository: z.output<typeof profileSchema>['repositories'][number],
): boolean =>
  mergeRequest.repositoryId === selection.repositoryId &&
  workspace.repositoryId === selection.repositoryId &&
  workspace.profilePosition === selection.profilePosition &&
  workspace.baseSha === mergeRequest.baseSha &&
  delivery.repositoryId === selection.repositoryId &&
  delivery.profilePosition === selection.profilePosition &&
  delivery.gitlabProject === mergeRequest.project &&
  delivery.mergeRequestIid === mergeRequest.iid &&
  delivery.mergeRequestUrl === mergeRequest.url &&
  delivery.sourceBranch === mergeRequest.sourceBranch &&
  delivery.targetBranch === mergeRequest.targetBranch &&
  delivery.headSha === mergeRequest.headSha &&
  profileRepository.repositoryId === selection.repositoryId &&
  profileRepository.profilePosition === selection.profilePosition &&
  profileRepository.gitlabProject === mergeRequest.project

const exactArtifactReadback = (
  artifact: ClickUpArtifact,
  input: z.output<typeof FinalizeClickUpInputSchema>,
  run: z.output<typeof runSchema>,
  content: string,
): boolean =>
  artifact.taskId === input.taskId &&
  artifact.commentId.trim() === artifact.commentId &&
  artifact.commentId.length > 0 &&
  artifact.envelope.runId === input.runId &&
  artifact.envelope.workflowId === run.workflowId &&
  artifact.envelope.revisionId === run.revisionId &&
  artifact.envelope.nodeId === 'finalize-delivery' &&
  artifact.envelope.artifactType === 'FINALIZATION' &&
  artifact.envelope.producer === 'finalize-gitlab-delivery' &&
  artifact.envelope.status === 'completed' &&
  artifact.content === content

export const createClickUpFinalizer = (
  options: CreateClickUpFinalizerOptions,
): ClickUpFinalizer => ({
  async finalize(inputValue) {
    const parsedInput = FinalizeClickUpInputSchema.safeParse(inputValue)
    if (!parsedInput.success) {
      return failed('DELIVERY_INPUT_INVALID', 'ClickUp finalization input is invalid', [])
    }
    const input = parsedInput.data
    const parsedRun = runSchema.safeParse(options.runs.get(input.runId))
    if (!parsedRun.success || parsedRun.data.taskSnapshot.taskId !== input.taskId) {
      return failed(
        'DELIVERY_CONTEXT_INVALID',
        'Run is not at the configured ClickUp finalization boundary',
        input.mergeRequests,
      )
    }
    let canonicalTaskId: ClickUpTaskId | undefined
    try {
      const taskReference = normalizeClickUpTaskReference(input.taskId)
      if (taskReference.kind === 'native') canonicalTaskId = taskReference.taskId
    } catch {
      canonicalTaskId = undefined
    }
    if (canonicalTaskId === undefined) {
      return failed(
        'DELIVERY_CONTEXT_INVALID',
        'Run does not contain a canonical native ClickUp task identity',
        input.mergeRequests,
      )
    }

    const run = parsedRun.data
    const profile = profileSchema.safeParse(options.profiles.getSnapshot(run.profileSnapshotId))
    const selections = z
      .array(selectionSchema)
      .max(32)
      .safeParse(options.runs.listSelections(input.runId))
    const workspaces = z
      .array(workspaceSchema)
      .max(32)
      .safeParse(options.runs.listWorkspaces(input.runId))
    const deliveries = z
      .array(deliveryEvidenceSchema)
      .max(32)
      .safeParse(options.runs.listDeliveryEvidence(input.runId))
    if (!profile.success || !selections.success || !workspaces.success || !deliveries.success) {
      return failed(
        'DELIVERY_CLICKUP_EVIDENCE_INCOMPLETE',
        'Persisted delivery evidence is invalid or incomplete',
        input.mergeRequests,
      )
    }

    const count = selections.data.length
    const profileById = new Map(
      profile.data.repositories.map((repository) => [repository.repositoryId, repository]),
    )
    const uniqueSelectionIds = new Set(selections.data.map(({ repositoryId }) => repositoryId))
    const ordered = selections.data.every(
      ({ profilePosition }, index) =>
        index === 0 || profilePosition > (selections.data[index - 1]?.profilePosition ?? -1),
    )
    const complete =
      count > 0 &&
      count === input.mergeRequests.length &&
      count === workspaces.data.length &&
      count === deliveries.data.length &&
      uniqueSelectionIds.size === count &&
      ordered &&
      input.mergeRequests.every((mergeRequest, index) => {
        const selection = selections.data[index]
        const workspace = workspaces.data[index]
        const delivery = deliveries.data[index]
        const profileRepository =
          selection === undefined ? undefined : profileById.get(selection.repositoryId)
        return (
          selection !== undefined &&
          workspace !== undefined &&
          delivery !== undefined &&
          profileRepository !== undefined &&
          sameEvidence(mergeRequest, selection, workspace, delivery, profileRepository)
        )
      })
    if (!complete) {
      return failed(
        'DELIVERY_CLICKUP_EVIDENCE_INCOMPLETE',
        'A complete verified merge request set is required before ClickUp finalization',
        input.mergeRequests,
      )
    }

    const content = renderClickUpFinalizationArtifact(run.taskSnapshot.url, input.mergeRequests)
    let artifact: ClickUpArtifact
    try {
      artifact = await options.clickup.publishArtifact({
        taskId: canonicalTaskId,
        runId: input.runId,
        workflowId: run.workflowId,
        revisionId: run.revisionId,
        nodeId: finalizationNodeId,
        artifactType: 'FINALIZATION',
        producer: 'finalize-gitlab-delivery',
        status: 'completed',
        content,
      })
    } catch (cause) {
      return failed(
        'DELIVERY_CLICKUP_ARTIFACT_FAILED',
        'ClickUp finalization artifact could not be published and read back',
        input.mergeRequests,
        externalFailureEvidence(cause),
      )
    }
    if (!exactArtifactReadback(artifact, input, run, content)) {
      return failed(
        'DELIVERY_CLICKUP_ARTIFACT_FAILED',
        'ClickUp finalization artifact identity did not match the requested run',
        input.mergeRequests,
        { name: 'ClickUpArtifactReadbackMismatch' },
        artifact,
      )
    }

    let task: ClickUpTaskSnapshot
    try {
      task = await options.clickup.moveToInReview(canonicalTaskId)
    } catch (cause) {
      return failed(
        'DELIVERY_CLICKUP_STATUS_FAILED',
        'ClickUp task could not be moved and read back in the configured In Review status',
        input.mergeRequests,
        externalFailureEvidence(cause),
        artifact,
      )
    }
    if (task.taskId !== input.taskId || task.status.id !== profile.data.clickupInReviewStatusId) {
      return failed(
        'DELIVERY_CLICKUP_STATUS_FAILED',
        'ClickUp task status identity did not match the profile snapshot',
        input.mergeRequests,
        { name: 'ClickUpStatusReadbackMismatch' },
        artifact,
      )
    }
    return {
      status: 'succeeded',
      mergeRequests: [...input.mergeRequests],
      artifact,
      task,
    }
  },
})

export const createDeliveryFinalizer = (
  options: CreateDeliveryFinalizerOptions,
): DeliveryFinalizer => ({
  async finalize(input, signal) {
    const gitlabResult: GitLabFinalizationResult = await options.gitlab.finalize(input, signal)
    if (gitlabResult.status === 'failed') return gitlabResult
    const clickupResult = await options.clickup.finalize({
      runId: input.runId,
      taskId: input.taskId,
      mergeRequests: gitlabResult.evidence,
    })
    if (clickupResult.status === 'succeeded') return clickupResult
    return {
      status: 'failed',
      error: clickupResult.error,
      partialEvidence: clickupResult.mergeRequests,
      ...(clickupResult.artifact === undefined ? {} : { artifact: clickupResult.artifact }),
    }
  },
})
