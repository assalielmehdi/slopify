import { isAbsolute, relative } from 'node:path'

import {
  ArtifactIdSchema,
  ArtifactTypeSchema,
  OutcomeNameSchema,
  RepositoryIdSchema,
  RevisionIdSchema,
  RunIdSchema,
} from '@loop/contracts'
import { PermissionProfileSchema } from '@loop/workflow-model'
import { z } from 'zod'

import type { LoadedResourceBundle } from './resource-loader.js'

const MAX_RENDERED_PROMPT_BYTES = 1_000_000
const nonBlank = z.string().trim().min(1)
const boundedText = nonBlank.max(16_384)
const content = z.string().min(1).max(1_000_000).refine((value) => value.trim().length > 0)
const absolutePath = z.string().min(1).max(4_096).refine(isAbsolute)
const sha = z.string().regex(/^[0-9a-f]{7,64}$/u)
const profilePosition = z.number().int().nonnegative().safe()

const ResourceBundleSchema = z.strictObject({
  bundleId: z.string().trim().min(1).max(128),
  applicationVersion: z.string().trim().min(1).max(128),
  skills: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(128),
        description: z.string().trim().min(1).max(2_048),
        content,
      }),
    )
    .max(32),
  promptFragments: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(128),
        content,
      }),
    )
    .max(32),
  contextFiles: z
    .array(
      z.strictObject({
        repositoryId: RepositoryIdSchema,
        path: absolutePath,
        content,
      }),
    )
    .max(128),
})

const CandidateRepositorySchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  profilePosition,
  purpose: z.string().trim().min(1).max(2_048),
  sourcePath: absolutePath,
})

const SelectedRepositorySchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  profilePosition,
  worktreePath: absolutePath,
  baseSha: sha,
  targetBranch: nonBlank.max(512),
  sourceBranch: nonBlank.max(512),
  responsibility: z.string().trim().min(1).max(2_048),
})

const ArtifactReferenceSchema = z.strictObject({
  artifactId: ArtifactIdSchema,
  runId: RunIdSchema,
  artifactType: ArtifactTypeSchema,
  content,
})

const CompletionContractSchema = z.strictObject({
  outcomes: z.array(OutcomeNameSchema).min(1).max(32),
  outputSchemaRef: nonBlank.max(512),
})

const VerificationEvidenceSchema = z.strictObject({
  kind: z.enum(['command', 'test', 'file', 'url', 'note']),
  value: boundedText,
})

const ReviewRepositorySchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  baseSha: sha,
  headSha: sha,
  changedFiles: z.array(z.string().min(1).max(4_096)).max(4_096),
  diff: z.string().max(750_000),
  latestVerification: z.strictObject({
    recordedAt: z.iso.datetime({ offset: true }),
    evidence: z.array(VerificationEvidenceSchema).max(128),
  }),
})

const commonShape = {
  templateRevision: RevisionIdSchema,
  promptTemplate: content,
  task: z.strictObject({
    reference: z.string().trim().min(1).max(512),
    snapshot: z.json(),
  }),
  objective: z.string().trim().min(1).max(4_096),
  boundaries: z.array(boundedText).min(1).max(32),
  artifacts: z.array(ArtifactReferenceSchema).max(32),
  stopConditions: z.array(boundedText).min(1).max(32),
  completionContract: CompletionContractSchema,
  resourceBundle: ResourceBundleSchema,
}

const RepositorySelectionPromptSchema = z.strictObject({
  ...commonShape,
  kind: z.literal('repository-selection'),
  permissionProfile: z.literal('read-only'),
  workspace: z.strictObject({
    policy: z.literal('candidate-repositories'),
    repositories: z.array(CandidateRepositorySchema).min(1).max(32),
  }),
})

const ExecutionPromptSchema = z.strictObject({
  ...commonShape,
  kind: z.literal('execution'),
  permissionProfile: PermissionProfileSchema,
  workspace: z.strictObject({
    policy: z.literal('selected-worktrees'),
    repositories: z.array(SelectedRepositorySchema).min(1).max(32),
  }),
})

const ReviewPromptSchema = z.strictObject({
  ...commonShape,
  kind: z.literal('review'),
  permissionProfile: z.literal('read-only'),
  workspace: z.strictObject({
    policy: z.literal('selected-worktrees'),
    repositories: z.array(SelectedRepositorySchema).min(1).max(32),
  }),
  reviewRepositories: z.array(ReviewRepositorySchema).min(1).max(32),
})

const RenderAgentPromptInputSchema = z.discriminatedUnion('kind', [
  RepositorySelectionPromptSchema,
  ExecutionPromptSchema,
  ReviewPromptSchema,
])

export type RenderAgentPromptInput = z.input<typeof RenderAgentPromptInputSchema>

export type PromptRendererErrorCode =
  | 'PROMPT_INPUT_INVALID'
  | 'PROMPT_RESOURCE_MISMATCH'
  | 'PROMPT_RESULT_TOO_LARGE'
  | 'PROMPT_REVIEW_INPUT_INVALID'

const messages: Readonly<Record<PromptRendererErrorCode, string>> = {
  PROMPT_INPUT_INVALID: 'Prompt renderer input is invalid',
  PROMPT_RESOURCE_MISMATCH: 'Prompt resources do not match the explicit workspace',
  PROMPT_RESULT_TOO_LARGE: 'Rendered prompt exceeds the size limit',
  PROMPT_REVIEW_INPUT_INVALID: 'Review input does not match the selected workspaces',
}

export class PromptRendererError extends Error {
  override readonly name = 'PromptRendererError'

  constructor(readonly code: PromptRendererErrorCode) {
    super(messages[code])
  }
}

export interface RenderedPromptRepository {
  readonly repositoryId: string
  readonly profilePosition: number
  readonly access: 'read-only' | 'workspace-write'
  readonly purpose?: string
  readonly sourcePath?: string
  readonly worktreePath?: string
  readonly baseSha?: string
  readonly targetBranch?: string
  readonly sourceBranch?: string
  readonly responsibility?: string
}

export interface RenderedPromptWorkspace {
  readonly policy: 'candidate-repositories' | 'selected-worktrees'
  readonly repositories: readonly RenderedPromptRepository[]
}

export interface RenderedReviewRepository {
  readonly repositoryId: string
  readonly baseSha: string
  readonly headSha: string
  readonly changedFiles: readonly string[]
  readonly diff: string
  readonly latestVerification: Readonly<{
    recordedAt: string
    evidence: readonly Readonly<{ kind: string; value: string }>[]
  }>
}

export interface RenderedAgentPrompt {
  readonly templateRevision: string
  readonly renderedPrompt: string
  readonly resourceBundle: LoadedResourceBundle
  readonly stopConditions: readonly string[]
  readonly completionContract: Readonly<{
    outcomes: readonly string[]
    outputSchemaRef: string
  }>
  readonly workspace: RenderedPromptWorkspace
  readonly reviewRepositories?: readonly RenderedReviewRepository[]
}

const hasDuplicates = <Value extends string | number>(values: readonly Value[]): boolean =>
  new Set(values).size !== values.length

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

const renderJsonSection = (title: string, value: unknown): string =>
  `## ${title}\n\n\`\`\`json\n${JSON.stringify(canonicalize(value), null, 2)}\n\`\`\``

const isChildPath = (parent: string, child: string): boolean => {
  const relativePath = relative(parent, child)
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith('../') &&
    !isAbsolute(relativePath)
  )
}

const freezeResourceBundle = (
  bundle: z.output<typeof ResourceBundleSchema>,
  contextFiles: readonly z.output<typeof ResourceBundleSchema>['contextFiles'][number][],
): LoadedResourceBundle =>
  Object.freeze({
    bundleId: bundle.bundleId,
    applicationVersion: bundle.applicationVersion,
    skills: Object.freeze(bundle.skills.map((skill) => Object.freeze({ ...skill }))),
    promptFragments: Object.freeze(
      bundle.promptFragments.map((fragment) => Object.freeze({ ...fragment })),
    ),
    contextFiles: Object.freeze(contextFiles.map((file) => Object.freeze({ ...file }))),
  })

const freezeReviewRepositories = (
  reviews: readonly z.output<typeof ReviewRepositorySchema>[],
): readonly RenderedReviewRepository[] =>
  Object.freeze(
    reviews.map((review) =>
      Object.freeze({
        ...review,
        changedFiles: Object.freeze([...review.changedFiles].sort()),
        latestVerification: Object.freeze({
          recordedAt: review.latestVerification.recordedAt,
          evidence: Object.freeze(
            review.latestVerification.evidence.map((evidence) => Object.freeze({ ...evidence })),
          ),
        }),
      }),
    ),
  )

export const renderAgentPrompt = (input: RenderAgentPromptInput): RenderedAgentPrompt => {
  const parsed = RenderAgentPromptInputSchema.safeParse(input)
  if (!parsed.success) throw new PromptRendererError('PROMPT_INPUT_INVALID')

  const repositories = [...parsed.data.workspace.repositories].sort(
    (left, right) => left.profilePosition - right.profilePosition,
  )
  if (
    hasDuplicates(repositories.map(({ repositoryId }) => repositoryId)) ||
    hasDuplicates(repositories.map(({ profilePosition }) => profilePosition))
  ) {
    throw new PromptRendererError('PROMPT_INPUT_INVALID')
  }
  const repositoryPaths = repositories.map((repository) =>
    'sourcePath' in repository ? repository.sourcePath : repository.worktreePath,
  )
  if (hasDuplicates(repositoryPaths)) throw new PromptRendererError('PROMPT_INPUT_INVALID')
  if (
    hasDuplicates(parsed.data.artifacts.map(({ artifactId }) => artifactId)) ||
    hasDuplicates(parsed.data.completionContract.outcomes)
  ) {
    throw new PromptRendererError('PROMPT_INPUT_INVALID')
  }

  const repositoryById = new Map(
    repositories.map((repository) => [repository.repositoryId, repository]),
  )
  for (const file of parsed.data.resourceBundle.contextFiles) {
    const repository = repositoryById.get(file.repositoryId)
    if (repository === undefined) throw new PromptRendererError('PROMPT_RESOURCE_MISMATCH')
    const repositoryPath =
      'sourcePath' in repository ? repository.sourcePath : repository.worktreePath
    if (!isChildPath(repositoryPath, file.path)) {
      throw new PromptRendererError('PROMPT_RESOURCE_MISMATCH')
    }
  }

  const contextFiles = [...parsed.data.resourceBundle.contextFiles].sort((left, right) => {
    const leftPosition = repositoryById.get(left.repositoryId)?.profilePosition ?? 0
    const rightPosition = repositoryById.get(right.repositoryId)?.profilePosition ?? 0
    return leftPosition === rightPosition
      ? left.path.localeCompare(right.path)
      : leftPosition - rightPosition
  })
  const resourceBundle = freezeResourceBundle(parsed.data.resourceBundle, contextFiles)
  const workspace: RenderedPromptWorkspace = Object.freeze({
    policy: parsed.data.workspace.policy,
    repositories: Object.freeze(
      repositories.map((repository) =>
        Object.freeze({ ...repository, access: parsed.data.permissionProfile }),
      ),
    ),
  })

  let reviewRepositories: readonly RenderedReviewRepository[] | undefined
  if (parsed.data.kind === 'review') {
    const reviewsById = new Map(
      parsed.data.reviewRepositories.map((review) => [review.repositoryId, review]),
    )
    if (
      reviewsById.size !== repositories.length ||
      parsed.data.reviewRepositories.length !== repositories.length
    ) {
      throw new PromptRendererError('PROMPT_REVIEW_INPUT_INVALID')
    }
    const orderedReviews: z.output<typeof ReviewRepositorySchema>[] = []
    for (const repository of repositories) {
      const review = reviewsById.get(repository.repositoryId)
      if (
        review === undefined ||
        !('baseSha' in repository) ||
        review.baseSha !== repository.baseSha ||
        hasDuplicates(review.changedFiles) ||
        review.changedFiles.some(
          (path) => isAbsolute(path) || path === '..' || path.startsWith('../'),
        )
      ) {
        throw new PromptRendererError('PROMPT_REVIEW_INPUT_INVALID')
      }
      orderedReviews.push(review)
    }
    reviewRepositories = freezeReviewRepositories(orderedReviews)
  }

  const artifacts = [...parsed.data.artifacts].sort((left, right) => {
    const typeOrder = left.artifactType.localeCompare(right.artifactType)
    return typeOrder === 0 ? left.artifactId.localeCompare(right.artifactId) : typeOrder
  })
  const completionContract = Object.freeze({
    outcomes: Object.freeze([...parsed.data.completionContract.outcomes]),
    outputSchemaRef: parsed.data.completionContract.outputSchemaRef,
  })
  const stopConditions = Object.freeze([...parsed.data.stopConditions])

  const sections = [
    '# Agent node execution',
    `## Workflow template\n\nRevision: ${parsed.data.templateRevision}\n\n${parsed.data.promptTemplate}`,
    `## Objective\n\n${parsed.data.objective}`,
    renderJsonSection('Boundaries', parsed.data.boundaries),
    renderJsonSection('Approved task reference', parsed.data.task),
    renderJsonSection('Explicit workspace map', workspace),
    renderJsonSection('Required prior artifacts', artifacts),
    renderJsonSection('Application-owned resource bundle', resourceBundle),
  ]
  if (reviewRepositories !== undefined) {
    sections.push(renderJsonSection('Repository-grouped review inputs', reviewRepositories))
  }
  sections.push(
    `## Completion boundary\n\nCall \`complete_node\` exactly once. Free-form assistant text and other tool output are not routing results.\n\n\`\`\`json\n${JSON.stringify(canonicalize(completionContract), null, 2)}\n\`\`\``,
    renderJsonSection('Stop conditions', stopConditions),
  )
  const renderedPrompt = sections.join('\n\n')
  if (new TextEncoder().encode(renderedPrompt).byteLength > MAX_RENDERED_PROMPT_BYTES) {
    throw new PromptRendererError('PROMPT_RESULT_TOO_LARGE')
  }

  return Object.freeze({
    templateRevision: parsed.data.templateRevision,
    renderedPrompt,
    resourceBundle,
    stopConditions,
    completionContract,
    workspace,
    ...(reviewRepositories === undefined ? {} : { reviewRepositories }),
  })
}
