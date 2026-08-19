import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  AgentExecutionEventSchema,
  type AgentExecutionInput,
  type AgentExecutor,
  type AgentNodeResult,
  type LoadedResourceBundle,
} from '@loop/agent-runtimes'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createGitReviewInputInspector,
  createProcessRunner,
  createReviewNodeExecutor,
  type ArtifactPublicationService,
  type ReviewKind,
} from '../../src/index.js'
import {
  TEST_REVISION_ID,
  TEST_RUN_ID,
  TEST_TIMESTAMP,
  TEST_WORKFLOW_ID,
  createPersistenceFixture,
} from '../persistence/test-fixture.js'

const REVIEW_NODES = [
  ['requirements-review', 'requirements'],
  ['security-review', 'security'],
  ['simplification-review', 'simplification'],
] as const

const fixtures: {
  readonly persistence: ReturnType<typeof createPersistenceFixture>
  readonly directory: string
}[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.persistence.cleanup()
    rmSync(fixture.directory, { force: true, recursive: true })
  }
})

const git = (cwd: string, ...arguments_: string[]): string =>
  execFileSync('git', ['-C', cwd, ...arguments_], { encoding: 'utf8' }).trim()

const createWorktree = (root: string, repositoryId: string) => {
  const path = join(root, repositoryId)
  const sourceBranch = 'ai/cu-123-run-01'
  mkdirSync(path, { recursive: true })
  execFileSync('git', ['init', '--initial-branch', sourceBranch, path])
  git(path, 'config', 'user.name', 'Slopify Test')
  git(path, 'config', 'user.email', 'slopify@example.test')
  writeFileSync(join(path, 'README.md'), `${repositoryId} baseline\n`)
  git(path, 'add', 'README.md')
  git(path, 'commit', '-m', 'Baseline')
  const baseSha = git(path, 'rev-parse', 'HEAD')
  writeFileSync(join(path, 'implementation.txt'), `${repositoryId} exact change\n`)
  git(path, 'add', 'implementation.txt')
  git(path, 'commit', '-m', `Implement ${repositoryId}`)
  return { path, sourceBranch, baseSha }
}

const bundleFor = (nodeId: string): LoadedResourceBundle => ({
  bundleId: `${nodeId}-v1`,
  applicationVersion: '1.0.0',
  skills: [],
  promptFragments: [],
  contextFiles: [],
})

const reviewedResult = (reviewKind: ReviewKind): AgentNodeResult => ({
  outcome: 'reviewed',
  summary: `${reviewKind} review completed`,
  data: {
    status: 'reviewed',
    reviewKind,
    repositories: [
      {
        repositoryId: 'docs',
        findings: [],
      },
      {
        repositoryId: 'api',
        findings:
          reviewKind === 'security'
            ? [
                {
                  severity: 'high',
                  title: 'Validate the boundary',
                  description: 'The changed boundary accepts an unchecked value.',
                  evidence: 'implementation.txt introduces the unchecked value.',
                  remediation: 'Validate the value before use.',
                },
              ]
            : [],
      },
    ],
  },
  artifacts: [],
  evidence: [],
})

const terminalEvent = (input: AgentExecutionInput, result: AgentNodeResult) =>
  AgentExecutionEventSchema.parse({
    executionId: input.executionId,
    runId: input.runId,
    nodeId: input.nodeId,
    timestamp: '2026-08-19T12:00:03Z',
    type: 'AGENT_RESULT',
    data: {
      result,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      durationMs: 25,
    },
  })

const createFixture = () => {
  const persistence = createPersistenceFixture()
  const directory = mkdtempSync(join(tmpdir(), 'slopify-review-nodes-'))
  fixtures.push({ persistence, directory })
  persistence.runs.create({
    runId: TEST_RUN_ID,
    workflowId: TEST_WORKFLOW_ID,
    revisionId: TEST_REVISION_ID,
    profileSnapshotId: persistence.snapshot.snapshotId,
    taskReference: 'CU-123',
    taskSnapshot: {
      taskId: '86abc123',
      title: 'Review the selected repositories',
      description: 'The exact approved task requirements.',
    },
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
  const worktreeRoot = join(directory, 'worktrees')
  const worktrees = {
    api: createWorktree(worktreeRoot, 'api'),
    docs: createWorktree(worktreeRoot, 'docs'),
  }
  for (const [repositoryId, worktree] of Object.entries(worktrees)) {
    persistence.runs.recordWorkspace({
      runId: TEST_RUN_ID,
      repositoryId,
      repositoryPath: worktree.path,
      worktreePath: worktree.path,
      remote: 'origin',
      targetBranch: 'main',
      sourceBranch: worktree.sourceBranch,
      baseSha: worktree.baseSha,
      createdAt: '2026-08-19T12:00:00Z',
    })
  }
  persistence.runs.startNode({
    runId: TEST_RUN_ID,
    nodeExecutionId: 'node-execution-verify-01',
    nodeId: 'verify',
    inputReferences: [],
    timestamp: '2026-08-19T12:00:01Z',
  })
  persistence.runs.completeNode({
    runId: TEST_RUN_ID,
    nodeExecutionId: 'node-execution-verify-01',
    nodeId: 'verify',
    outcome: 'passed',
    durationMs: 10,
    artifactIds: [],
    output: {
      commandId: 'verify-selected-repositories',
      recordedAt: '2026-08-19T12:00:02Z',
      repositories: [
        {
          repositoryId: 'api',
          profilePosition: 0,
          status: 'passed',
          commands: [
            {
              commandIndex: 0,
              command: { executable: 'pnpm', arguments: ['test'] },
              status: 'passed',
              processStatus: 'exited',
              exitCode: 0,
              signal: null,
              durationMs: 5,
              stdout: 'api verification passed',
              stderr: '',
              stdoutTruncated: false,
              stderrTruncated: false,
            },
          ],
        },
        {
          repositoryId: 'docs',
          profilePosition: 2,
          status: 'passed',
          commands: [
            {
              commandIndex: 0,
              command: { executable: 'pnpm', arguments: ['lint'] },
              status: 'passed',
              processStatus: 'exited',
              exitCode: 0,
              signal: null,
              durationMs: 5,
              stdout: 'docs verification passed',
              stderr: '',
              stdoutTruncated: false,
              stderrTruncated: false,
            },
          ],
        },
      ],
      totals: {
        repositoryCount: 2,
        commandCount: 2,
        passedCommandCount: 2,
        failedCommandCount: 0,
      },
    },
    timestamp: '2026-08-19T12:00:02Z',
  })
  const loadExact = vi.fn<ArtifactPublicationService['loadExact']>(async (input) => ({
    artifactId:
      input.artifactType === 'EXECUTION_PLAN' ? 'artifact-plan-01' : 'artifact-implementation-01',
    runId: TEST_RUN_ID,
    artifactType: input.artifactType,
    content:
      input.artifactType === 'EXECUTION_PLAN'
        ? '# Exact execution plan'
        : '# Exact implementation summary',
    commentId: input.artifactType === 'EXECUTION_PLAN' ? 'comment-plan' : 'comment-implementation',
  }))
  const publish = vi.fn<ArtifactPublicationService['publish']>()
  const artifacts = { loadExact, publish } satisfies ArtifactPublicationService
  return {
    persistence,
    directory,
    artifacts,
    worktrees,
    selectedWorkspaceRoot: join(directory, 'run-workspaces'),
  }
}

const contextFor = (
  fixture: ReturnType<typeof createFixture>,
  nodeId: (typeof REVIEW_NODES)[number][0],
) => {
  const node = fixture.persistence.revision.nodes.find((candidate) => candidate.id === nodeId)
  const run = fixture.persistence.runs.get(TEST_RUN_ID)
  if (node?.type !== 'agent' || run === undefined) throw new Error('Review fixture is invalid')
  const nodeExecutionId = `node-execution-${nodeId}`
  fixture.persistence.runs.startNode({
    runId: TEST_RUN_ID,
    nodeExecutionId,
    nodeId,
    inputReferences: [],
    timestamp: '2026-08-19T12:00:03Z',
  })
  return {
    run,
    workflow: fixture.persistence.revision,
    node,
    nodeExecutionId,
    signal: new AbortController().signal,
  }
}

describe('specialized review nodes', () => {
  it('runs fresh read-only sessions sequentially with exact artifacts, diffs, and verification', async () => {
    const fixture = createFixture()
    const intervals: { readonly nodeId: string; readonly start: number; end?: number }[] = []
    const inputs: AgentExecutionInput[] = []
    let clock = 0
    let activeSessions = 0
    let maximumActiveSessions = 0
    const agent: AgentExecutor = {
      execute: vi.fn<AgentExecutor['execute']>((input) =>
        (async function* () {
          const interval: { nodeId: string; start: number; end?: number } = {
            nodeId: input.nodeId,
            start: ++clock,
          }
          intervals.push(interval)
          inputs.push(input)
          activeSessions += 1
          maximumActiveSessions = Math.max(maximumActiveSessions, activeSessions)
          const reviewKind = REVIEW_NODES.find(([nodeId]) => nodeId === input.nodeId)?.[1]
          if (reviewKind === undefined) throw new Error('Unexpected review node')
          yield terminalEvent(input, reviewedResult(reviewKind))
          activeSessions -= 1
          interval.end = ++clock
        })(),
      ),
      cancel: vi.fn<AgentExecutor['cancel']>(async () => ({ status: 'cancelled' })),
    }
    const inspector = createGitReviewInputInspector({
      processRunner: createProcessRunner({ maxOutputBytes: 750_000 }),
      commandTimeoutMs: 10_000,
    })

    const results = []
    for (const [nodeId, reviewKind] of REVIEW_NODES) {
      const executor = createReviewNodeExecutor({
        reviewKind,
        agent,
        artifacts: fixture.artifacts,
        inspector,
        resourceBundle: bundleFor(nodeId),
        runs: fixture.persistence.runs,
        selectedWorkspaceRoot: fixture.selectedWorkspaceRoot,
      })
      results.push(await executor.execute(contextFor(fixture, nodeId)))
    }

    expect(results).toMatchObject(
      REVIEW_NODES.map(([, reviewKind]) => ({
        status: 'succeeded',
        outcome: 'reviewed',
        artifactIds: [],
        output: { data: { status: 'reviewed', reviewKind } },
      })),
    )
    expect(maximumActiveSessions).toBe(1)
    expect(intervals).toEqual([
      { nodeId: 'requirements-review', start: 1, end: 2 },
      { nodeId: 'security-review', start: 3, end: 4 },
      { nodeId: 'simplification-review', start: 5, end: 6 },
    ])
    expect(new Set(inputs.map(({ executionId }) => executionId)).size).toBe(3)
    expect(
      inputs.every(
        (input) =>
          input.permissionProfile === 'read-only' &&
          input.workspace.repositories.every(({ access }) => access === 'read-only'),
      ),
    ).toBe(true)
    for (const input of inputs) {
      expect(input.renderedPrompt).toContain('The exact approved task requirements.')
      expect(input.renderedPrompt).toContain('# Exact execution plan')
      expect(input.renderedPrompt).toContain('# Exact implementation summary')
      expect(input.renderedPrompt).toContain('implementation.txt')
      expect(input.renderedPrompt).toContain('api exact change')
      expect(input.renderedPrompt).toContain('api verification passed')
      expect(input.renderedPrompt).toContain('docs verification passed')
      expect(input.renderedPrompt).not.toContain('repositoryId\": \"web')
    }
    expect(fixture.artifacts.loadExact).toHaveBeenCalledTimes(6)
    expect(fixture.artifacts.publish).not.toHaveBeenCalled()
    expect(fixture.persistence.runs.listArtifacts(TEST_RUN_ID)).toEqual([])
  })

  it('blocks a review that omits a selected repository without publishing', async () => {
    const fixture = createFixture()
    const result = reviewedResult('requirements')
    const invalidResult: AgentNodeResult = {
      ...result,
      data: {
        status: 'reviewed',
        reviewKind: 'requirements',
        repositories: [{ repositoryId: 'api', findings: [] }],
      },
    }
    const agent: AgentExecutor = {
      execute: (input) =>
        (async function* () {
          yield terminalEvent(input, invalidResult)
        })(),
      cancel: async () => ({ status: 'cancelled' }),
    }
    const executor = createReviewNodeExecutor({
      reviewKind: 'requirements',
      agent,
      artifacts: fixture.artifacts,
      inspector: createGitReviewInputInspector({
        processRunner: createProcessRunner({ maxOutputBytes: 750_000 }),
        commandTimeoutMs: 10_000,
      }),
      resourceBundle: bundleFor('requirements-review'),
      runs: fixture.persistence.runs,
      selectedWorkspaceRoot: fixture.selectedWorkspaceRoot,
    })

    await expect(
      executor.execute(contextFor(fixture, 'requirements-review')),
    ).resolves.toMatchObject({
      status: 'succeeded',
      outcome: 'blocked',
      artifactIds: [],
    })
    expect(fixture.artifacts.publish).not.toHaveBeenCalled()
  })
})
