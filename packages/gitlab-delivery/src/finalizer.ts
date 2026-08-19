import {
  FinalizeGitLabInputSchema,
  MergeRequestEvidenceSchema,
  type FinalizeGitLabInput,
  type GitWorkspace,
  type MergeRequestEvidence,
  type RunId,
} from '@loop/contracts'
import {
  VerificationNodeOutputSchema,
  type JsonValue,
  type UpsertDeliveryEvidenceInput,
} from '@loop/execution-runtime'
import { z } from 'zod'

import type { DeliveryError } from './errors.js'
import type { GlabClient, GlabFailure } from './glab.js'
import { renderMergeRequestTemplate, type RenderedMergeRequestTemplate } from './mr-template.js'

const taskSnapshotSchema = z.looseObject({
  taskId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(512),
  url: z.url().max(4_096),
})

const implementationOutputSchema = z.looseObject({
  summary: z.string().trim().min(1).max(16_384),
  data: z.looseObject({
    status: z.literal('implemented'),
    repositories: z
      .array(
        z.looseObject({
          repositoryId: z.string().trim().min(1).max(128),
          summary: z.string().trim().min(1).max(16_384),
        }),
      )
      .min(1)
      .max(32),
  }),
})

const planOutputSchema = z.looseObject({
  data: z.looseObject({
    risks: z.array(z.string().trim().min(1).max(16_384)).max(128),
  }),
})

const fixOutputSchema = z.looseObject({
  data: z.looseObject({
    status: z.literal('fixed'),
    repositories: z.array(
      z.looseObject({
        repositoryId: z.string().trim().min(1).max(128),
        status: z.enum(['changed', 'unchanged']),
        summary: z.string().trim().min(1).max(16_384),
      }),
    ),
  }),
})

interface FinalizationRun {
  readonly runId: string
  readonly profileSnapshotId: string
  readonly taskSnapshot: JsonValue
  readonly status: string
  readonly currentNodeId: string | null
}

interface FinalizationSelection {
  readonly repositoryId: string
  readonly profilePosition: number
}

interface FinalizationWorkspace extends GitWorkspace {
  readonly profilePosition: number
}

interface FinalizationNodeExecution {
  readonly nodeExecutionId: string
  readonly nodeId: string
  readonly executionIndex: number
  readonly status: string
  readonly outcome: string | null
  readonly output: JsonValue | null
}

interface FinalizationArtifact {
  readonly artifactType: string
  readonly metadata: JsonValue
}

interface FinalizationProfileRepository {
  readonly repositoryId: string
  readonly profilePosition: number
  readonly displayName: string
  readonly gitlabProject: string
  readonly mergeRequestLabels: readonly string[]
}

export interface FinalizationProfileStore {
  getSnapshot(snapshotId: string):
    | Readonly<{
        readonly profileId: string
        readonly repositories: readonly FinalizationProfileRepository[]
      }>
    | undefined
}

export interface FinalizationRunStore {
  get(runId: RunId): FinalizationRun | undefined
  listSelections(runId: RunId): readonly FinalizationSelection[]
  listWorkspaces(runId: RunId): readonly FinalizationWorkspace[]
  listNodeExecutions(runId: RunId): readonly FinalizationNodeExecution[]
  listArtifacts(runId: RunId): readonly FinalizationArtifact[]
  listDeliveryEvidence(runId: RunId): readonly unknown[]
  upsertDeliveryEvidence(input: UpsertDeliveryEvidenceInput): void
}

export interface FinalizationGitInspection {
  readonly headSha: string
}

export type FinalizationGitResult<Value, Evidence> =
  | Readonly<{ status: 'succeeded'; value: Value; evidence: Evidence }>
  | Readonly<{ status: 'failed'; failure: Readonly<{ evidence: JsonValue }> }>

export interface FinalizationGitClient {
  inspect(
    workspace: GitWorkspace,
    signal?: AbortSignal,
  ): Promise<FinalizationGitResult<FinalizationGitInspection, readonly JsonValue[]>>
  push(
    workspace: GitWorkspace,
    signal?: AbortSignal,
  ): Promise<FinalizationGitResult<true, JsonValue>>
}

export type GitLabFinalizationResult =
  | Readonly<{ status: 'succeeded'; evidence: readonly MergeRequestEvidence[] }>
  | Readonly<{
      status: 'failed'
      error: DeliveryError
      partialEvidence: readonly MergeRequestEvidence[]
    }>

export interface GitLabFinalizer {
  finalize(input: FinalizeGitLabInput, signal?: AbortSignal): Promise<GitLabFinalizationResult>
}

export interface CreateGitLabFinalizerOptions {
  readonly profiles: FinalizationProfileStore
  readonly runs: FinalizationRunStore
  readonly git: FinalizationGitClient
  readonly glab: GlabClient
  readonly now?: () => string
}

interface PreparedRepository {
  readonly workspace: FinalizationWorkspace
  readonly profile: FinalizationProfileRepository
  readonly headSha: string
  readonly gitInspectionEvidence: readonly JsonValue[]
  readonly template: RenderedMergeRequestTemplate
}

const asJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

const failure = (
  error: DeliveryError,
  partialEvidence: readonly MergeRequestEvidence[] = [],
): GitLabFinalizationResult => ({ status: 'failed', error, partialEvidence: [...partialEvidence] })

const metadataStatus = (artifact: FinalizationArtifact): string | undefined => {
  if (
    artifact.metadata === null ||
    typeof artifact.metadata !== 'object' ||
    Array.isArray(artifact.metadata) ||
    !('status' in artifact.metadata)
  ) {
    return undefined
  }
  return typeof artifact.metadata.status === 'string' ? artifact.metadata.status : undefined
}

const exactArtifactStatus = (
  artifacts: readonly FinalizationArtifact[],
  artifactType: string,
  acceptedStatuses: readonly string[],
): boolean => {
  const matches = artifacts.filter((artifact) => artifact.artifactType === artifactType)
  const match = matches[0]
  return (
    matches.length === 1 &&
    match !== undefined &&
    acceptedStatuses.some((status) => status === metadataStatus(match))
  )
}

const sameWorkspace = (left: GitWorkspace, right: GitWorkspace): boolean =>
  left.repositoryId === right.repositoryId &&
  left.repositoryPath === right.repositoryPath &&
  left.worktreePath === right.worktreePath &&
  left.remote === right.remote &&
  left.targetBranch === right.targetBranch &&
  left.sourceBranch === right.sourceBranch &&
  left.baseSha === right.baseSha

const findSuccessful = (
  executions: readonly FinalizationNodeExecution[],
  nodeId: string,
  outcome: string,
) =>
  executions
    .filter(
      (execution) =>
        execution.nodeId === nodeId &&
        execution.status === 'SUCCEEDED' &&
        execution.outcome === outcome,
    )
    .at(-1)

const commandLabel = (
  command: z.output<
    typeof VerificationNodeOutputSchema
  >['repositories'][number]['commands'][number],
): string => {
  const rendered = [command.command.executable, ...command.command.arguments].join(' ')
  return `${rendered} — ${command.status}`
}

const glabErrorEvidence = (failure: GlabFailure): JsonValue => asJson(failure)

export const createGitLabFinalizer = (options: CreateGitLabFinalizerOptions): GitLabFinalizer => {
  const now = options.now ?? (() => new Date().toISOString())

  return {
    async finalize(inputValue, signal) {
      const parsedInput = FinalizeGitLabInputSchema.safeParse(inputValue)
      if (!parsedInput.success) {
        return failure({
          code: 'DELIVERY_INPUT_INVALID',
          message: 'GitLab finalization input is invalid',
        })
      }
      const input = parsedInput.data
      const run = options.runs.get(input.runId)
      const task = taskSnapshotSchema.safeParse(run?.taskSnapshot)
      if (
        run === undefined ||
        run.status !== 'RUNNING' ||
        run.currentNodeId !== 'finalize-delivery' ||
        !task.success ||
        task.data.taskId !== input.taskId
      ) {
        return failure({
          code: 'DELIVERY_CONTEXT_INVALID',
          message: 'Run is not at the configured GitLab finalization boundary',
        })
      }

      const profile = options.profiles.getSnapshot(run.profileSnapshotId)
      const selections = options.runs.listSelections(input.runId)
      const persistedWorkspaces = options.runs.listWorkspaces(input.runId)
      const inputById = new Map(
        input.workspaces.map((workspace) => [workspace.repositoryId, workspace]),
      )
      const selectedProfiles = profile?.repositories
        .filter(({ repositoryId }) =>
          selections.some((selection) => selection.repositoryId === repositoryId),
        )
        .toSorted((left, right) => left.profilePosition - right.profilePosition)
      if (
        profile === undefined ||
        selections.length === 0 ||
        selections.length !== persistedWorkspaces.length ||
        selections.length !== input.workspaces.length ||
        selectedProfiles === undefined ||
        selectedProfiles.length !== selections.length ||
        persistedWorkspaces.some((workspace, index) => {
          const inputWorkspace = inputById.get(workspace.repositoryId)
          return (
            workspace.repositoryId !== selections[index]?.repositoryId ||
            workspace.profilePosition !== selections[index]?.profilePosition ||
            selectedProfiles[index]?.repositoryId !== workspace.repositoryId ||
            inputWorkspace === undefined ||
            !sameWorkspace(workspace, inputWorkspace)
          )
        })
      ) {
        return failure({
          code: 'DELIVERY_SELECTION_MISMATCH',
          message: 'Finalization workspaces do not match the immutable selected set',
        })
      }
      if (options.runs.listDeliveryEvidence(input.runId).length !== 0) {
        return failure({
          code: 'DELIVERY_DUPLICATE_MERGE_REQUEST',
          message: 'Delivery evidence already exists for this run',
        })
      }

      const artifacts = options.runs.listArtifacts(input.runId)
      if (
        !exactArtifactStatus(artifacts, 'IMPLEMENTATION_SUMMARY', ['completed']) ||
        !exactArtifactStatus(artifacts, 'REVIEW_SUMMARY', ['completed', 'resolved'])
      ) {
        return failure({
          code: 'DELIVERY_ARTIFACT_INVALID',
          message: 'Finalization requires completed implementation and resolved review artifacts',
        })
      }

      const executions = options.runs.listNodeExecutions(input.runId)
      const current = executions.find(
        (execution) => execution.nodeId === 'finalize-delivery' && execution.status === 'RUNNING',
      )
      const aggregate = findSuccessful(executions, 'aggregate-review', 'clean')
      const verificationExecution = findSuccessful(executions, 'verify', 'passed')
      const implementationExecution = findSuccessful(executions, 'implement', 'implemented')
      const planExecution = findSuccessful(executions, 'plan', 'ready')
      const verification = VerificationNodeOutputSchema.safeParse(verificationExecution?.output)
      const implementation = implementationOutputSchema.safeParse(implementationExecution?.output)
      const plan = planOutputSchema.safeParse(planExecution?.output)
      const reviews = ['requirements-review', 'security-review', 'simplification-review'].map(
        (nodeId) => findSuccessful(executions, nodeId, 'reviewed'),
      )
      const reviewSequenceValid =
        verificationExecution !== undefined &&
        aggregate !== undefined &&
        reviews.every((review, index) => {
          const previous = reviews[index - 1]
          return (
            review !== undefined &&
            review.executionIndex > verificationExecution.executionIndex &&
            (previous === undefined || review.executionIndex > previous.executionIndex) &&
            review.executionIndex < aggregate.executionIndex
          )
        })
      if (
        current === undefined ||
        aggregate === undefined ||
        aggregate.executionIndex + 1 !== current.executionIndex ||
        verificationExecution === undefined ||
        !reviewSequenceValid ||
        !verification.success ||
        !implementation.success ||
        !plan.success ||
        verification.data.repositories.length !== persistedWorkspaces.length ||
        implementation.data.data.repositories.length !== persistedWorkspaces.length
      ) {
        return failure({
          code: 'DELIVERY_CONTEXT_INVALID',
          message: 'Required successful verification and review predecessors are unavailable',
        })
      }

      const fixSummaries = new Map<string, string[]>()
      for (const execution of executions) {
        if (
          execution.nodeId !== 'fix-findings' ||
          execution.status !== 'SUCCEEDED' ||
          execution.outcome !== 'fixed'
        ) {
          continue
        }
        const fix = fixOutputSchema.safeParse(execution.output)
        if (!fix.success) {
          return failure({
            code: 'DELIVERY_CONTEXT_INVALID',
            message: 'Persisted fix resolution evidence is invalid',
          })
        }
        for (const repository of fix.data.data.repositories) {
          if (repository.status !== 'changed') continue
          const summaries = fixSummaries.get(repository.repositoryId) ?? []
          summaries.push(repository.summary)
          fixSummaries.set(repository.repositoryId, summaries)
        }
      }

      const prepared: PreparedRepository[] = []
      for (const [index, workspace] of persistedWorkspaces.entries()) {
        const profileRepository = selectedProfiles[index]
        const repositoryVerification = verification.data.repositories[index]
        const repositoryImplementation = implementation.data.data.repositories.find(
          ({ repositoryId }) => repositoryId === workspace.repositoryId,
        )
        if (
          profileRepository === undefined ||
          repositoryVerification?.repositoryId !== workspace.repositoryId ||
          repositoryVerification.profilePosition !== workspace.profilePosition ||
          repositoryVerification.status !== 'passed' ||
          repositoryImplementation === undefined
        ) {
          return failure({
            code: 'DELIVERY_CONTEXT_INVALID',
            message: 'Repository-specific implementation or verification evidence is unavailable',
            repositoryId: workspace.repositoryId,
          })
        }
        const inspected = await options.git.inspect(workspace, signal)
        if (inspected.status === 'failed') {
          return failure({
            code: 'DELIVERY_GIT_PRECONDITION_FAILED',
            message: `Git preconditions failed for repository ${workspace.repositoryId}`,
            repositoryId: workspace.repositoryId,
            evidence: inspected.failure.evidence,
          })
        }
        let template: RenderedMergeRequestTemplate
        try {
          template = renderMergeRequestTemplate({
            task: task.data,
            repository: {
              repositoryId: workspace.repositoryId,
              displayName: profileRepository.displayName,
              sourceBranch: workspace.sourceBranch,
              targetBranch: workspace.targetBranch,
            },
            summary: repositoryImplementation.summary,
            changes: [
              repositoryImplementation.summary,
              ...(fixSummaries.get(workspace.repositoryId) ?? []),
            ],
            verification: repositoryVerification.commands.map(commandLabel),
            risks: plan.data.data.risks,
            rollback: `Revert the commits on \`${workspace.sourceBranch}\`.`,
          })
        } catch {
          return failure({
            code: 'DELIVERY_CONTEXT_INVALID',
            message: `Merge request evidence is invalid for repository ${workspace.repositoryId}`,
            repositoryId: workspace.repositoryId,
          })
        }
        prepared.push({
          workspace,
          profile: profileRepository,
          headSha: inspected.value.headSha,
          gitInspectionEvidence: inspected.evidence,
          template,
        })
      }

      for (const repository of prepared) {
        const discovered = await options.glab.listOpenMergeRequests(
          {
            project: repository.profile.gitlabProject,
            sourceBranch: repository.workspace.sourceBranch,
            targetBranch: repository.workspace.targetBranch,
          },
          signal,
        )
        if (discovered.status === 'failed') {
          return failure({
            code: 'DELIVERY_GITLAB_DISCOVERY_FAILED',
            message: `Existing merge requests could not be inspected for repository ${repository.workspace.repositoryId}`,
            repositoryId: repository.workspace.repositoryId,
            evidence: glabErrorEvidence(discovered.failure),
          })
        }
        if (discovered.value.length !== 0) {
          return failure({
            code: 'DELIVERY_DUPLICATE_MERGE_REQUEST',
            message: `An open merge request already exists for repository ${repository.workspace.repositoryId}`,
            repositoryId: repository.workspace.repositoryId,
            evidence: asJson(discovered.evidence),
          })
        }
      }

      const verified: MergeRequestEvidence[] = []
      for (const repository of prepared) {
        const commandEvidence: JsonValue[] = [...repository.gitInspectionEvidence]
        const persist = (
          evidenceInput: Omit<UpsertDeliveryEvidenceInput, 'runId' | 'repositoryId' | 'updatedAt'>,
        ) => {
          options.runs.upsertDeliveryEvidence({
            runId: input.runId,
            repositoryId: repository.workspace.repositoryId,
            ...evidenceInput,
            updatedAt: now(),
          })
        }
        const failAfterMutation = (
          error: DeliveryError,
          evidenceValue?: unknown,
        ): GitLabFinalizationResult => {
          try {
            persist({
              status: 'FAILED',
              evidence: asJson({ commands: commandEvidence, failure: evidenceValue ?? error }),
            })
          } catch {
            return failure(
              {
                code: 'DELIVERY_PERSISTENCE_FAILED',
                message: `Delivery failure evidence could not be persisted for repository ${repository.workspace.repositoryId}`,
                repositoryId: repository.workspace.repositoryId,
                evidence: asJson({
                  commands: commandEvidence,
                  failure: evidenceValue ?? error,
                }),
              },
              verified,
            )
          }
          return failure(error, verified)
        }

        const pushed = await options.git.push(repository.workspace, signal)
        if (pushed.status === 'failed') {
          return failAfterMutation(
            {
              code: 'DELIVERY_PUSH_FAILED',
              message: `Source branch push failed for repository ${repository.workspace.repositoryId}`,
              repositoryId: repository.workspace.repositoryId,
              evidence: pushed.failure.evidence,
            },
            pushed.failure,
          )
        }
        commandEvidence.push(pushed.evidence)
        try {
          persist({
            status: 'BRANCH_PUSHED',
            headSha: repository.headSha,
            evidence: commandEvidence,
          })
        } catch {
          return failure(
            {
              code: 'DELIVERY_PERSISTENCE_FAILED',
              message: `Pushed branch evidence could not be persisted for repository ${repository.workspace.repositoryId}`,
              repositoryId: repository.workspace.repositoryId,
              evidence: asJson({ commands: commandEvidence }),
            },
            verified,
          )
        }

        const created = await options.glab.createMergeRequest(
          {
            project: repository.profile.gitlabProject,
            sourceBranch: repository.workspace.sourceBranch,
            targetBranch: repository.workspace.targetBranch,
            title: repository.template.title,
            description: repository.template.body,
            labels: repository.profile.mergeRequestLabels,
          },
          signal,
        )
        if (created.status === 'failed') {
          return failAfterMutation(
            {
              code: 'DELIVERY_GITLAB_CREATE_FAILED',
              message: `Merge request creation failed for repository ${repository.workspace.repositoryId}`,
              repositoryId: repository.workspace.repositoryId,
              evidence: glabErrorEvidence(created.failure),
            },
            created.failure,
          )
        }
        commandEvidence.push(asJson(created.evidence))
        try {
          persist({
            status: 'MERGE_REQUEST_CREATED',
            gitlabProject: repository.profile.gitlabProject,
            sourceBranch: repository.workspace.sourceBranch,
            targetBranch: repository.workspace.targetBranch,
            headSha: repository.headSha,
            evidence: commandEvidence,
          })
        } catch {
          return failure(
            {
              code: 'DELIVERY_PERSISTENCE_FAILED',
              message: `Created merge request evidence could not be persisted for repository ${repository.workspace.repositoryId}`,
              repositoryId: repository.workspace.repositoryId,
              evidence: asJson({ commands: commandEvidence }),
            },
            verified,
          )
        }

        const readback = await options.glab.listOpenMergeRequests(
          {
            project: repository.profile.gitlabProject,
            sourceBranch: repository.workspace.sourceBranch,
            targetBranch: repository.workspace.targetBranch,
          },
          signal,
        )
        if (readback.status === 'failed') {
          return failAfterMutation(
            {
              code: 'DELIVERY_MERGE_REQUEST_READBACK_FAILED',
              message: `Merge request read-back failed for repository ${repository.workspace.repositoryId}`,
              repositoryId: repository.workspace.repositoryId,
              evidence: glabErrorEvidence(readback.failure),
            },
            readback.failure,
          )
        }
        commandEvidence.push(asJson(readback.evidence))
        const mergeRequest = readback.value[0]
        const parsedEvidence = MergeRequestEvidenceSchema.safeParse({
          repositoryId: repository.workspace.repositoryId,
          project: repository.profile.gitlabProject,
          iid: mergeRequest?.iid,
          url: mergeRequest?.url,
          state: mergeRequest?.state,
          sourceBranch: mergeRequest?.sourceBranch,
          targetBranch: mergeRequest?.targetBranch,
          baseSha: repository.workspace.baseSha,
          headSha: mergeRequest?.headSha,
        })
        if (
          readback.value.length !== 1 ||
          !parsedEvidence.success ||
          parsedEvidence.data.sourceBranch !== repository.workspace.sourceBranch ||
          parsedEvidence.data.targetBranch !== repository.workspace.targetBranch ||
          parsedEvidence.data.headSha !== repository.headSha
        ) {
          return failAfterMutation(
            {
              code: 'DELIVERY_MERGE_REQUEST_READBACK_FAILED',
              message: `Merge request identity did not match repository ${repository.workspace.repositoryId}`,
              repositoryId: repository.workspace.repositoryId,
              evidence: asJson(readback),
            },
            readback,
          )
        }
        const mergeRequestEvidence = parsedEvidence.data
        try {
          persist({
            status: 'VERIFIED',
            gitlabProject: mergeRequestEvidence.project,
            mergeRequestIid: mergeRequestEvidence.iid,
            mergeRequestUrl: mergeRequestEvidence.url,
            sourceBranch: mergeRequestEvidence.sourceBranch,
            targetBranch: mergeRequestEvidence.targetBranch,
            headSha: mergeRequestEvidence.headSha,
            evidence: { commands: commandEvidence, identity: mergeRequestEvidence },
          })
        } catch {
          return failure(
            {
              code: 'DELIVERY_PERSISTENCE_FAILED',
              message: `Verified merge request evidence could not be persisted for repository ${repository.workspace.repositoryId}`,
              repositoryId: repository.workspace.repositoryId,
              evidence: asJson({ commands: commandEvidence, identity: mergeRequestEvidence }),
            },
            [...verified, mergeRequestEvidence],
          )
        }
        verified.push(mergeRequestEvidence)
      }
      return { status: 'succeeded', evidence: verified }
    },
  }
}
