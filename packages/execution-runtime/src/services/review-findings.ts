import { RepositoryIdSchema } from '@loop/contracts'
import { z } from 'zod'

const boundedText = z.string().trim().min(1).max(16_384)

export const ReviewKindSchema = z.enum(['requirements', 'security', 'simplification'])

export const ReviewFindingSchema = z.strictObject({
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  title: boundedText,
  description: boundedText,
  evidence: boundedText,
  remediation: boundedText,
})

const blockedReview = z.strictObject({
  status: z.literal('blocked'),
  reviewKind: ReviewKindSchema,
  reason: boundedText,
  discoveredRepositoryIds: z.array(RepositoryIdSchema).max(32).readonly(),
})

const reviewedRepository = z.strictObject({
  repositoryId: RepositoryIdSchema,
  findings: z.array(ReviewFindingSchema).max(128).readonly(),
})

const reviewed = z.strictObject({
  status: z.literal('reviewed'),
  reviewKind: ReviewKindSchema,
  repositories: z.array(reviewedRepository).min(1).max(32).readonly(),
})

export const ReviewFindingsOutputSchema = z.discriminatedUnion('status', [
  blockedReview,
  reviewed,
])

const agentEvidence = z.strictObject({
  kind: z.enum(['command', 'test', 'file', 'url', 'note']),
  value: boundedText,
})

export const PersistedReviewNodeOutputSchema = z.strictObject({
  summary: z.string().trim().min(1).max(4_096),
  data: reviewed,
  evidence: z.array(agentEvidence).max(128).readonly(),
})

export type ReviewKind = z.infer<typeof ReviewKindSchema>
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>
export type ReviewFindingsOutput = z.infer<typeof ReviewFindingsOutputSchema>
export type PersistedReviewNodeOutput = z.infer<typeof PersistedReviewNodeOutputSchema>

export interface ReviewRepositoryIdentity {
  readonly repositoryId: string
  readonly profilePosition: number
}

export const canonicalizeReviewedFindings = (
  repositories: readonly ReviewRepositoryIdentity[],
  reviewKind: ReviewKind,
  input: z.output<typeof reviewed>,
): z.output<typeof reviewed> | undefined => {
  const expectedIds = repositories.map(({ repositoryId }) => repositoryId)
  const actualIds = input.repositories.map(({ repositoryId }) => repositoryId)
  const actualIdSet = new Set<string>(actualIds)
  if (
    input.reviewKind !== reviewKind ||
    new Set(actualIds).size !== actualIds.length ||
    actualIds.length !== expectedIds.length ||
    expectedIds.some((repositoryId) => !actualIdSet.has(repositoryId))
  ) {
    return undefined
  }
  const byId = new Map<string, z.output<typeof reviewedRepository>>(
    input.repositories.map((repository) => [repository.repositoryId, repository]),
  )
  return {
    ...input,
    repositories: repositories.map((repository) => byId.get(repository.repositoryId) as z.output<
      typeof reviewedRepository
    >),
  }
}
