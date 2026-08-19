import { GitShaSchema, RepositoryIdSchema } from '@loop/contracts'
import { z } from 'zod'

import type { ProcessRunResult, ProcessRunner } from '../processes/process-runner.js'
import type { SelectedAgentRepository } from '../executors/delivery-agent-node.js'

const boundedText = z.string().trim().min(1).max(16_384)
const resolutionSource = z.enum(['failed-verification', 'aggregated-findings'])
const resolutionEvidence = z.strictObject({
  kind: z.enum(['command', 'test', 'file', 'url', 'note']),
  value: boundedText,
})

const blocked = z.strictObject({
  status: z.literal('blocked'),
  source: resolutionSource,
  reason: boundedText,
  discoveredRepositoryIds: z.array(RepositoryIdSchema).max(32).readonly(),
})

const changedRepository = z.strictObject({
  repositoryId: RepositoryIdSchema,
  status: z.literal('changed'),
  previousHeadSha: GitShaSchema,
  commitSha: GitShaSchema,
  summary: boundedText,
  evidence: z.array(resolutionEvidence).min(1).max(128).readonly(),
})

const unchangedRepository = z.strictObject({
  repositoryId: RepositoryIdSchema,
  status: z.literal('unchanged'),
  headSha: GitShaSchema,
  summary: boundedText,
  evidence: z.array(resolutionEvidence).min(1).max(128).readonly(),
})

const fixed = z.strictObject({
  status: z.literal('fixed'),
  source: resolutionSource,
  repositories: z
    .array(z.discriminatedUnion('status', [changedRepository, unchangedRepository]))
    .min(1)
    .max(32)
    .readonly(),
})

export const FindingResolutionOutputSchema = z.discriminatedUnion('status', [blocked, fixed])
export type FindingResolutionOutput = z.infer<typeof FindingResolutionOutputSchema>

export interface FindingResolutionBaseline {
  readonly repositoryId: string
  readonly headSha: string
}

export interface FindingResolutionEvidence extends FindingResolutionBaseline {
  readonly commitsSinceBaseline: number
}

export type FindingResolutionInspectionResult<Evidence> =
  | Readonly<{ status: 'succeeded'; evidence: readonly Evidence[] }>
  | Readonly<{ status: 'failed' }>
  | Readonly<{ status: 'cancelled' }>

export interface FindingResolutionInspector {
  inspectBefore(
    repositories: readonly SelectedAgentRepository[],
    signal: AbortSignal,
  ): Promise<FindingResolutionInspectionResult<FindingResolutionBaseline>>
  inspectAfter(
    repositories: readonly SelectedAgentRepository[],
    baselines: readonly FindingResolutionBaseline[],
    signal: AbortSignal,
  ): Promise<FindingResolutionInspectionResult<FindingResolutionEvidence>>
}

export interface CreateGitFindingResolutionInspectorOptions {
  readonly processRunner: ProcessRunner
  readonly commandTimeoutMs: number
}

const successful = (result: ProcessRunResult): boolean =>
  result.status === 'exited' && result.exitCode === 0

const cancelled = (results: readonly ProcessRunResult[]): boolean =>
  results.some(({ status }) => status === 'cancelled')

export const createGitFindingResolutionInspector = (
  options: CreateGitFindingResolutionInspectorOptions,
): FindingResolutionInspector => {
  if (!Number.isSafeInteger(options.commandTimeoutMs) || options.commandTimeoutMs <= 0) {
    throw new TypeError('commandTimeoutMs must be a positive safe integer')
  }
  const run = (
    repository: SelectedAgentRepository,
    arguments_: readonly string[],
    signal: AbortSignal,
  ) =>
    options.processRunner.run({
      executable: 'git',
      arguments: ['-C', repository.worktreePath, ...arguments_],
      cwd: repository.worktreePath,
      timeoutMs: options.commandTimeoutMs,
      signal,
    })

  const inspectIdentity = async (
    repository: SelectedAgentRepository,
    signal: AbortSignal,
  ) => {
    const branch = await run(repository, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal)
    const status = await run(repository, ['status', '--porcelain=v1'], signal)
    const head = await run(repository, ['rev-parse', '--verify', 'HEAD^{commit}'], signal)
    const results = [branch, status, head]
    const parsedHead = GitShaSchema.safeParse(head.stdout.trim())
    if (cancelled(results)) return { status: 'cancelled' as const }
    if (
      results.some((result) => !successful(result)) ||
      branch.stdout.trim() !== repository.sourceBranch ||
      status.stdout !== '' ||
      !parsedHead.success
    ) {
      return { status: 'failed' as const }
    }
    return { status: 'succeeded' as const, headSha: parsedHead.data }
  }

  return {
    async inspectBefore(repositories, signal) {
      const evidence: FindingResolutionBaseline[] = []
      for (const repository of repositories) {
        const identity = await inspectIdentity(repository, signal)
        if (identity.status !== 'succeeded') return identity
        const ahead = await run(
          repository,
          ['rev-list', '--count', `${repository.baseSha}..HEAD`],
          signal,
        )
        if (ahead.status === 'cancelled') return { status: 'cancelled' }
        const commitCount = Number.parseInt(ahead.stdout.trim(), 10)
        if (!successful(ahead) || !Number.isSafeInteger(commitCount) || commitCount < 1) {
          return { status: 'failed' }
        }
        evidence.push({ repositoryId: repository.repositoryId, headSha: identity.headSha })
      }
      return { status: 'succeeded', evidence }
    },

    async inspectAfter(repositories, baselines, signal) {
      if (
        baselines.length !== repositories.length ||
        repositories.some(
          (repository, index) => repository.repositoryId !== baselines[index]?.repositoryId,
        )
      ) {
        return { status: 'failed' }
      }
      const evidence: FindingResolutionEvidence[] = []
      for (const [index, repository] of repositories.entries()) {
        const baseline = baselines[index]
        if (baseline === undefined) return { status: 'failed' }
        const identity = await inspectIdentity(repository, signal)
        if (identity.status !== 'succeeded') return identity
        const ancestor = await run(
          repository,
          ['merge-base', '--is-ancestor', baseline.headSha, 'HEAD'],
          signal,
        )
        const commits = await run(
          repository,
          ['rev-list', '--count', `${baseline.headSha}..HEAD`],
          signal,
        )
        const results = [ancestor, commits]
        if (cancelled(results)) return { status: 'cancelled' }
        const commitCount = Number.parseInt(commits.stdout.trim(), 10)
        if (
          results.some((result) => !successful(result)) ||
          !Number.isSafeInteger(commitCount) ||
          commitCount < 0
        ) {
          return { status: 'failed' }
        }
        evidence.push({
          repositoryId: repository.repositoryId,
          headSha: identity.headSha,
          commitsSinceBaseline: commitCount,
        })
      }
      return { status: 'succeeded', evidence }
    },
  }
}
