import {
  NodeIdSchema,
  RepositoryIdSchema,
  RevisionIdSchema,
  WorkflowIdSchema,
} from '@loop/contracts'
import { z } from 'zod'

import type { RunRepository } from '../persistence/run-repository.js'
import type { ArtifactPublicationService } from '../services/artifact-publication.js'
import {
  PersistedReviewNodeOutputSchema,
  type ReviewFinding,
  type ReviewKind,
} from '../services/review-findings.js'
import type { NodeExecutor } from './registry.js'

const COMMAND_ID = 'aggregate-review-findings'
const reviewSequence = [
  ['requirements-review', 'requirements'],
  ['security-review', 'security'],
  ['simplification-review', 'simplification'],
] as const

const aggregateFinding = z.strictObject({
  reviewKind: z.enum(['requirements', 'security', 'simplification']),
  repositoryId: RepositoryIdSchema,
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  title: z.string().trim().min(1).max(16_384),
  description: z.string().trim().min(1).max(16_384),
  evidence: z.string().trim().min(1).max(16_384),
  remediation: z.string().trim().min(1).max(16_384),
})

export const AggregateReviewOutputSchema = z.strictObject({
  status: z.enum(['changes-required', 'clean']),
  reviewPass: z.number().int().positive().safe(),
  findingCount: z.number().int().nonnegative().safe(),
  findings: z.array(aggregateFinding).max(12_288).readonly(),
})

export type AggregateReviewOutput = z.infer<typeof AggregateReviewOutputSchema>

export interface CreateAggregateReviewNodeExecutorOptions {
  readonly artifacts: ArtifactPublicationService
  readonly runs: RunRepository
}

interface AggregateFinding extends ReviewFinding {
  readonly reviewKind: ReviewKind
  readonly repositoryId: string
}

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const
const reviewOrder = { requirements: 0, security: 1, simplification: 2 } as const

const compareFindings = (left: AggregateFinding, right: AggregateFinding): number =>
  severityOrder[left.severity] - severityOrder[right.severity] ||
  left.title.localeCompare(right.title) ||
  left.description.localeCompare(right.description) ||
  left.evidence.localeCompare(right.evidence) ||
  left.remediation.localeCompare(right.remediation)

const renderSummary = (output: AggregateReviewOutput): string => {
  const sections = output.findings.length
    ? output.findings.flatMap((finding, index) => [
        `### ${index + 1}. ${finding.title}`,
        '',
        `- Review: ${finding.reviewKind}`,
        `- Repository: \`${finding.repositoryId}\``,
        `- Severity: ${finding.severity}`,
        `- Description: ${finding.description}`,
        `- Evidence: ${finding.evidence}`,
        `- Remediation: ${finding.remediation}`,
        '',
      ])
    : ['No actionable findings remain.', '']
  return [
    `# Review pass ${output.reviewPass}`,
    '',
    `Status: ${output.status}`,
    '',
    `Validated findings: ${output.findingCount}`,
    '',
    '## Findings',
    '',
    ...sections,
  ].join('\n')
}

const failed = () => ({
  status: 'failed' as const,
  code: 'AGGREGATE_REVIEW_INPUT_INVALID',
  message: 'Current sequential review findings are unavailable',
})

const taskId = (snapshot: unknown): string | undefined => {
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    !('taskId' in snapshot) ||
    typeof snapshot.taskId !== 'string' ||
    !/^[a-z0-9]{1,128}$/i.test(snapshot.taskId)
  ) {
    return undefined
  }
  return snapshot.taskId
}

export const createAggregateReviewNodeExecutor = (
  options: CreateAggregateReviewNodeExecutorOptions,
): NodeExecutor => ({
  async execute(context) {
    if (
      context.node.type !== 'command' ||
      context.node.id !== 'aggregate-review' ||
      context.node.commandId !== COMMAND_ID ||
      !context.node.outcomes.some((outcome) => outcome === 'changes-required') ||
      !context.node.outcomes.some((outcome) => outcome === 'clean')
    ) {
      return {
        status: 'failed',
        code: 'AGGREGATE_REVIEW_CONTEXT_INVALID',
        message: 'Aggregate review context is invalid',
      }
    }
    const canonicalTaskId = taskId(context.run.taskSnapshot)
    const selections = options.runs.listSelections(context.run.runId)
    const executions = options.runs.listNodeExecutions(context.run.runId)
    const current = executions.find(
      ({ nodeExecutionId }) => nodeExecutionId === context.nodeExecutionId,
    )
    if (canonicalTaskId === undefined || selections.length === 0 || current?.status !== 'RUNNING') {
      return failed()
    }
    const beforeCurrent = executions.filter(
      ({ executionIndex }) => executionIndex < current.executionIndex,
    )
    const verification = beforeCurrent
      .filter(
        ({ nodeId, status, outcome }) =>
          nodeId === 'verify' && status === 'SUCCEEDED' && outcome === 'passed',
      )
      .at(-1)
    if (verification === undefined) return failed()
    const reviews = beforeCurrent.filter(
      ({ executionIndex, nodeId }) =>
        executionIndex > verification.executionIndex &&
        reviewSequence.some(([expectedNodeId]) => expectedNodeId === nodeId),
    )
    if (
      reviews.length !== reviewSequence.length ||
      reviews.some(
        (execution, index) =>
          execution.nodeId !== reviewSequence[index]?.[0] ||
          execution.status !== 'SUCCEEDED' ||
          execution.outcome !== 'reviewed' ||
          execution.output === null,
      )
    ) {
      return failed()
    }

    const repositoryPosition = new Map<string, number>(
      selections.map(({ repositoryId, profilePosition }) => [repositoryId, profilePosition]),
    )
    const findings: AggregateFinding[] = []
    for (const [index, execution] of reviews.entries()) {
      const parsed = PersistedReviewNodeOutputSchema.safeParse(execution.output)
      const expectedKind = reviewSequence[index]?.[1]
      if (
        !parsed.success ||
        parsed.data.data.reviewKind !== expectedKind ||
        parsed.data.data.repositories.length !== selections.length ||
        parsed.data.data.repositories.some(
          (repository, repositoryIndex) =>
            repository.repositoryId !== selections[repositoryIndex]?.repositoryId,
        )
      ) {
        return failed()
      }
      for (const repository of parsed.data.data.repositories) {
        for (const finding of repository.findings) {
          findings.push({
            reviewKind: parsed.data.data.reviewKind,
            repositoryId: repository.repositoryId,
            ...finding,
          })
        }
      }
    }
    findings.sort(
      (left, right) =>
        reviewOrder[left.reviewKind] - reviewOrder[right.reviewKind] ||
        (repositoryPosition.get(left.repositoryId) ?? 0) -
          (repositoryPosition.get(right.repositoryId) ?? 0) ||
        compareFindings(left, right),
    )
    const reviewPass =
      beforeCurrent.filter(
        ({ nodeId, status }) => nodeId === 'aggregate-review' && status === 'SUCCEEDED',
      ).length + 1
    const output = AggregateReviewOutputSchema.parse({
      status: findings.length === 0 ? 'clean' : 'changes-required',
      reviewPass,
      findingCount: findings.length,
      findings,
    })
    const content = renderSummary(output)
    const existing = options.runs
      .listArtifacts(context.run.runId)
      .filter(({ artifactType }) => artifactType === 'REVIEW_SUMMARY')
    if (existing.length > 1) return failed()

    try {
      const artifact =
        existing.length === 0
          ? await options.artifacts.publish({
              taskId: canonicalTaskId,
              runId: context.run.runId,
              workflowId: WorkflowIdSchema.parse(context.run.workflowId),
              revisionId: RevisionIdSchema.parse(context.run.revisionId),
              nodeId: NodeIdSchema.parse(COMMAND_ID),
              nodeExecutionId: context.nodeExecutionId,
              artifactType: 'REVIEW_SUMMARY',
              title: 'Review summary',
              content,
              status: output.status === 'clean' ? 'completed' : 'changes-requested',
            })
          : await options.artifacts.updateReviewSummary({
              taskId: canonicalTaskId,
              runId: context.run.runId,
              workflowId: WorkflowIdSchema.parse(context.run.workflowId),
              revisionId: RevisionIdSchema.parse(context.run.revisionId),
              nodeId: NodeIdSchema.parse(COMMAND_ID),
              nodeExecutionId: context.nodeExecutionId,
              status: output.status === 'clean' ? 'resolved' : 'changes-requested',
              appendContent: content,
            })
      return {
        status: 'succeeded',
        outcome: output.status === 'clean' ? 'clean' : 'changes-required',
        artifactIds: [artifact.artifactId],
        output,
      }
    } catch {
      return {
        status: 'failed',
        code: 'AGGREGATE_REVIEW_PUBLICATION_FAILED',
        message: 'Review summary could not be published or updated and read back',
      }
    }
  },
})
