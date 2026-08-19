import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createAggregateReviewNodeExecutor,
  createArtifactPublicationService,
  type ArtifactConnector,
  type ReviewKind,
} from '../../src/index.js'
import {
  TEST_REVISION_ID,
  TEST_RUN_ID,
  TEST_TIMESTAMP,
  TEST_WORKFLOW_ID,
  createPersistenceFixture,
} from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createConnector = () => {
  let artifact: Awaited<ReturnType<ArtifactConnector['publishArtifact']>> | undefined
  const publishArtifact = vi.fn<ArtifactConnector['publishArtifact']>(async (input) => {
    if (artifact !== undefined) throw new Error('Duplicate artifact')
    artifact = {
      taskId: input.taskId,
      commentId: 'review-comment-01',
      author: 'Workflow Connector',
      createdAt: '2026-08-19T12:00:10Z',
      envelope: {
        runId: input.runId,
        workflowId: input.workflowId,
        revisionId: input.revisionId,
        nodeId: input.nodeId,
        artifactType: input.artifactType,
        producer: input.producer,
        status: input.status,
      },
      content: input.content,
    }
    return artifact
  })
  const getArtifact = vi.fn<ArtifactConnector['getArtifact']>(async () => {
    if (artifact === undefined) throw new Error('Artifact not found')
    return artifact
  })
  const updateReviewSummary = vi.fn(
    async (input: {
      readonly taskId: string
      readonly runId: string
      readonly commentId: string
      readonly status: 'changes-requested' | 'resolved'
      readonly appendContent: string
    }) => {
      if (
        artifact === undefined ||
        artifact.taskId !== input.taskId ||
        artifact.envelope.runId !== input.runId ||
        artifact.commentId !== input.commentId ||
        artifact.envelope.artifactType !== 'REVIEW_SUMMARY' ||
        artifact.envelope.status === 'completed'
      ) {
        throw new Error('Review artifact mismatch')
      }
      artifact = {
        ...artifact,
        envelope: { ...artifact.envelope, status: input.status },
        content: `${artifact.content}\n\n---\n\n${input.appendContent}`,
      }
      return artifact
    },
  )
  const connector = {
    publishArtifact,
    getArtifact,
    updateReviewSummary,
  } satisfies ArtifactConnector
  return {
    connector,
    get artifact() {
      return artifact
    },
    publishArtifact,
    updateReviewSummary,
    tamperRevision() {
      if (artifact === undefined) throw new Error('Artifact not found')
      artifact = {
        ...artifact,
        envelope: { ...artifact.envelope, revisionId: 'wrong-revision' as never },
      }
    },
  }
}

const finding = (title: string, severity: 'critical' | 'high' | 'medium' | 'low' = 'high') => ({
  severity,
  title,
  description: `${title} description`,
  evidence: `${title} evidence`,
  remediation: `${title} remediation`,
})

const reviewOutput = (
  reviewKind: ReviewKind,
  input: Readonly<{
    api?: readonly ReturnType<typeof finding>[]
    docs?: readonly ReturnType<typeof finding>[]
  }> = {},
) => ({
  summary: `${reviewKind} review completed`,
  data: {
    status: 'reviewed',
    reviewKind,
    repositories: [
      { repositoryId: 'api', findings: input.api ?? [] },
      { repositoryId: 'docs', findings: input.docs ?? [] },
    ],
  },
  evidence: [],
})

const createFixture = () => {
  const persistence = createPersistenceFixture()
  fixtures.push(persistence)
  persistence.runs.create({
    runId: TEST_RUN_ID,
    workflowId: TEST_WORKFLOW_ID,
    revisionId: TEST_REVISION_ID,
    profileSnapshotId: persistence.snapshot.snapshotId,
    taskReference: 'CU-123',
    taskSnapshot: { taskId: '86abc123', title: 'Aggregate exact review findings' },
    effectiveConfiguration: persistence.revision,
    createdAt: TEST_TIMESTAMP,
  })
  persistence.runs.changeStatus({
    runId: TEST_RUN_ID,
    expectedStatus: 'PENDING',
    status: 'RUNNING',
    timestamp: '2026-08-19T12:00:00Z',
  })
  persistence.runs.selectRepositories({
    runId: TEST_RUN_ID,
    selectedAt: '2026-08-19T12:00:00Z',
    selection: {
      selected: [
        { repositoryId: 'docs', rationale: 'Docs change', responsibility: 'Review docs' },
        { repositoryId: 'api', rationale: 'API change', responsibility: 'Review api' },
      ],
      excluded: [{ repositoryId: 'web', rationale: 'No UI change' }],
    },
  })
  const remote = createConnector()
  const artifacts = createArtifactPublicationService({
    connector: remote.connector,
    runs: persistence.runs,
    producer: 'aggregate-review-findings',
    createArtifactId: () => 'artifact-review-01',
    now: () => '2026-08-19T12:00:10Z',
  })
  const executor = createAggregateReviewNodeExecutor({
    artifacts,
    runs: persistence.runs,
  })
  return { persistence, remote, executor }
}

const recordReviewCycle = (
  fixture: ReturnType<typeof createFixture>,
  pass: number,
  outputs: Readonly<{
    requirements: ReturnType<typeof reviewOutput>
    security: ReturnType<typeof reviewOutput>
    simplification: ReturnType<typeof reviewOutput>
  }>,
) => {
  const timestamp = `2026-08-19T12:00:${String(pass * 10).padStart(2, '0')}Z`
  const verifyExecutionId = `node-execution-verify-${pass}`
  fixture.persistence.runs.startNode({
    runId: TEST_RUN_ID,
    nodeExecutionId: verifyExecutionId,
    nodeId: 'verify',
    inputReferences: [],
    timestamp,
  })
  fixture.persistence.runs.completeNode({
    runId: TEST_RUN_ID,
    nodeExecutionId: verifyExecutionId,
    nodeId: 'verify',
    outcome: 'passed',
    durationMs: 1,
    artifactIds: [],
    output: { pass },
    timestamp,
  })
  for (const [nodeId, reviewKind] of [
    ['requirements-review', 'requirements'],
    ['security-review', 'security'],
    ['simplification-review', 'simplification'],
  ] as const) {
    const nodeExecutionId = `node-execution-${nodeId}-${pass}`
    fixture.persistence.runs.startNode({
      runId: TEST_RUN_ID,
      nodeExecutionId,
      nodeId,
      inputReferences: [],
      timestamp,
    })
    fixture.persistence.runs.completeNode({
      runId: TEST_RUN_ID,
      nodeExecutionId,
      nodeId,
      outcome: 'reviewed',
      durationMs: 1,
      artifactIds: [],
      output: outputs[reviewKind],
      timestamp,
    })
  }
}

const contextFor = (fixture: ReturnType<typeof createFixture>, pass: number) => {
  const node = fixture.persistence.revision.nodes.find(({ id }) => id === 'aggregate-review')
  const run = fixture.persistence.runs.get(TEST_RUN_ID)
  if (node?.type !== 'command' || run === undefined) throw new Error('Aggregate fixture invalid')
  const nodeExecutionId = `node-execution-aggregate-${pass}`
  fixture.persistence.runs.startNode({
    runId: TEST_RUN_ID,
    nodeExecutionId,
    nodeId: node.id,
    inputReferences: [],
    timestamp: `2026-08-19T12:00:${String(pass * 10 + 1).padStart(2, '0')}Z`,
  })
  return {
    run,
    workflow: fixture.persistence.revision,
    node,
    nodeExecutionId,
    signal: new AbortController().signal,
  }
}

const completeAggregate = (
  fixture: ReturnType<typeof createFixture>,
  pass: number,
  result: Awaited<ReturnType<ReturnType<typeof createAggregateReviewNodeExecutor>['execute']>>,
) => {
  if (
    result === null ||
    typeof result !== 'object' ||
    !('status' in result) ||
    result.status !== 'succeeded' ||
    !('outcome' in result) ||
    !('artifactIds' in result) ||
    !('output' in result)
  ) {
    throw new Error('Aggregate result did not succeed')
  }
  fixture.persistence.runs.completeNode({
    runId: TEST_RUN_ID,
    nodeExecutionId: `node-execution-aggregate-${pass}`,
    nodeId: 'aggregate-review',
    outcome: String(result.outcome),
    durationMs: 1,
    artifactIds: result.artifactIds as readonly string[],
    output: result.output as never,
    timestamp: `2026-08-19T12:00:${String(pass * 10 + 2).padStart(2, '0')}Z`,
  })
}

describe('aggregate review', () => {
  it('publishes once, updates the exact summary, and preserves deterministic history', async () => {
    const fixture = createFixture()
    recordReviewCycle(fixture, 1, {
      requirements: reviewOutput('requirements', {
        docs: [finding('Document the fallback', 'low')],
        api: [finding('Reject incomplete input', 'critical')],
      }),
      security: reviewOutput('security', {
        api: [finding('Validate the trust boundary', 'high')],
      }),
      simplification: reviewOutput('simplification'),
    })

    const first = await fixture.executor.execute(contextFor(fixture, 1))

    expect(first).toMatchObject({
      status: 'succeeded',
      outcome: 'changes-required',
      artifactIds: ['artifact-review-01'],
      output: {
        status: 'changes-required',
        reviewPass: 1,
        findingCount: 3,
      },
    })
    expect(fixture.remote.publishArtifact).toHaveBeenCalledOnce()
    expect(fixture.remote.publishArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactType: 'REVIEW_SUMMARY',
        producer: 'aggregate-review-findings',
        status: 'changes-requested',
      }),
    )
    expect(fixture.remote.artifact?.content.indexOf('Reject incomplete input')).toBeLessThan(
      fixture.remote.artifact?.content.indexOf('Document the fallback') ?? -1,
    )
    expect(fixture.remote.artifact?.content.indexOf('Document the fallback')).toBeLessThan(
      fixture.remote.artifact?.content.indexOf('Validate the trust boundary') ?? -1,
    )
    completeAggregate(fixture, 1, first)

    recordReviewCycle(fixture, 2, {
      requirements: reviewOutput('requirements'),
      security: reviewOutput('security'),
      simplification: reviewOutput('simplification'),
    })
    const second = await fixture.executor.execute(contextFor(fixture, 2))

    expect(second).toMatchObject({
      status: 'succeeded',
      outcome: 'clean',
      artifactIds: ['artifact-review-01'],
      output: {
        status: 'clean',
        reviewPass: 2,
        findingCount: 0,
      },
    })
    expect(fixture.remote.publishArtifact).toHaveBeenCalledOnce()
    expect(fixture.remote.updateReviewSummary).toHaveBeenCalledOnce()
    expect(fixture.remote.updateReviewSummary).toHaveBeenCalledWith({
      taskId: '86abc123',
      runId: TEST_RUN_ID,
      commentId: 'review-comment-01',
      status: 'resolved',
      appendContent: expect.stringContaining('# Review pass 2'),
    })
    expect(fixture.remote.artifact).toMatchObject({
      commentId: 'review-comment-01',
      envelope: { status: 'resolved' },
    })
    expect(fixture.remote.artifact?.content).toContain('# Review pass 1')
    expect(fixture.remote.artifact?.content).toContain('# Review pass 2')
    expect(fixture.persistence.runs.listArtifacts(TEST_RUN_ID)).toEqual([
      expect.objectContaining({
        artifactId: 'artifact-review-01',
        artifactType: 'REVIEW_SUMMARY',
        content: fixture.remote.artifact?.content,
        metadata: expect.objectContaining({ status: 'resolved' }),
      }),
    ])
  })

  it('publishes an initially clean review as completed', async () => {
    const fixture = createFixture()
    recordReviewCycle(fixture, 1, {
      requirements: reviewOutput('requirements'),
      security: reviewOutput('security'),
      simplification: reviewOutput('simplification'),
    })

    await expect(fixture.executor.execute(contextFor(fixture, 1))).resolves.toMatchObject({
      status: 'succeeded',
      outcome: 'clean',
      output: { status: 'clean', findingCount: 0 },
    })
    expect(fixture.remote.publishArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' }),
    )
    expect(fixture.remote.updateReviewSummary).not.toHaveBeenCalled()
  })

  it('rejects a stale remote envelope before issuing an update mutation', async () => {
    const fixture = createFixture()
    recordReviewCycle(fixture, 1, {
      requirements: reviewOutput('requirements', { api: [finding('Fix the contract')] }),
      security: reviewOutput('security'),
      simplification: reviewOutput('simplification'),
    })
    const first = await fixture.executor.execute(contextFor(fixture, 1))
    completeAggregate(fixture, 1, first)
    fixture.remote.tamperRevision()
    recordReviewCycle(fixture, 2, {
      requirements: reviewOutput('requirements'),
      security: reviewOutput('security'),
      simplification: reviewOutput('simplification'),
    })

    await expect(fixture.executor.execute(contextFor(fixture, 2))).resolves.toEqual({
      status: 'failed',
      code: 'AGGREGATE_REVIEW_PUBLICATION_FAILED',
      message: 'Review summary could not be published or updated and read back',
    })
    expect(fixture.remote.updateReviewSummary).not.toHaveBeenCalled()
    expect(fixture.persistence.runs.listArtifacts(TEST_RUN_ID)[0]?.content).toContain(
      '# Review pass 1',
    )
    expect(fixture.persistence.runs.listArtifacts(TEST_RUN_ID)[0]?.content).not.toContain(
      '# Review pass 2',
    )
  })

  it('fails before publication when the current sequential review set is incomplete', async () => {
    const fixture = createFixture()
    const timestamp = '2026-08-19T12:00:10Z'
    for (const [nodeId, output] of [
      ['requirements-review', reviewOutput('requirements')],
      ['security-review', reviewOutput('security')],
    ] as const) {
      const nodeExecutionId = `node-execution-${nodeId}-1`
      fixture.persistence.runs.startNode({
        runId: TEST_RUN_ID,
        nodeExecutionId,
        nodeId,
        inputReferences: [],
        timestamp,
      })
      fixture.persistence.runs.completeNode({
        runId: TEST_RUN_ID,
        nodeExecutionId,
        nodeId,
        outcome: 'reviewed',
        durationMs: 1,
        artifactIds: [],
        output,
        timestamp,
      })
    }

    await expect(fixture.executor.execute(contextFor(fixture, 1))).resolves.toEqual({
      status: 'failed',
      code: 'AGGREGATE_REVIEW_INPUT_INVALID',
      message: 'Current sequential review findings are unavailable',
    })
    expect(fixture.remote.publishArtifact).not.toHaveBeenCalled()
    expect(fixture.remote.updateReviewSummary).not.toHaveBeenCalled()
  })
})
