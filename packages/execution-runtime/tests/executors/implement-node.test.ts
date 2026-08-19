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
  createArtifactPublicationService,
  createGitCommitInspector,
  createImplementationNodeExecutor,
  createPlanNodeExecutor,
  createProcessRunner,
  type ArtifactConnector,
} from '../../src/index.js'
import {
  TEST_REVISION_ID,
  TEST_RUN_ID,
  TEST_TIMESTAMP,
  TEST_WORKFLOW_ID,
  createPersistenceFixture,
} from '../persistence/test-fixture.js'

const planBundle: LoadedResourceBundle = {
  bundleId: 'delivery-planning-v1',
  applicationVersion: '1.0.0',
  skills: [],
  promptFragments: [],
  contextFiles: [],
}

const implementationBundle: LoadedResourceBundle = {
  bundleId: 'delivery-implementation-v1',
  applicationVersion: '1.0.0',
  skills: [],
  promptFragments: [],
  contextFiles: [],
}

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
  return { path, sourceBranch, baseSha }
}

const commitImplementation = (path: string, repositoryId: string): string => {
  writeFileSync(join(path, 'implementation.txt'), `${repositoryId} implemented\n`)
  git(path, 'add', 'implementation.txt')
  git(path, 'commit', '-m', `Implement ${repositoryId}`)
  return git(path, 'rev-parse', 'HEAD')
}

const agentEvent = (input: AgentExecutionInput, result: AgentNodeResult) =>
  AgentExecutionEventSchema.parse({
    executionId: input.executionId,
    runId: input.runId,
    nodeId: input.nodeId,
    timestamp: '2026-08-19T12:00:00Z',
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

const createAgent = (result: AgentNodeResult, onInput?: (input: AgentExecutionInput) => void) => {
  const execute = vi.fn<AgentExecutor['execute']>((input) =>
    (async function* () {
      onInput?.(input)
      yield agentEvent(input, result)
    })(),
  )
  return {
    agent: {
      execute,
      cancel: vi.fn<AgentExecutor['cancel']>(async () => ({ status: 'cancelled' })),
    },
    execute,
  }
}

const createArtifactConnector = () => {
  const published: Awaited<ReturnType<ArtifactConnector['publishArtifact']>>[] = []
  const connector: ArtifactConnector = {
    async publishArtifact(input) {
      const artifact = {
        taskId: input.taskId,
        commentId: `comment-${published.length + 1}`,
        author: 'Workflow Connector',
        createdAt: '2026-08-19T12:00:01Z',
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
      } as const
      published.push(artifact)
      return artifact
    },
    async getArtifact(input) {
      const artifact = published.find(
        (candidate) =>
          candidate.taskId === input.taskId &&
          candidate.envelope.runId === input.runId &&
          candidate.envelope.artifactType === input.artifactType,
      )
      if (artifact === undefined) throw new Error('Artifact not found')
      return artifact
    },
  }
  return { connector, published }
}

const planResult: AgentNodeResult = {
  outcome: 'ready',
  summary: 'Plan ready',
  data: {
    status: 'ready',
    repositories: ['api', 'docs'].map((repositoryId) => ({
      repositoryId,
      responsibility: `Implement ${repositoryId}`,
      work: [`Change ${repositoryId}`],
      verification: [`Test ${repositoryId}`],
    })),
    crossRepositoryContracts: [
      { repositoryIds: ['api', 'docs'], description: 'Keep the API contract aligned.' },
    ],
    orderedSteps: ['api', 'docs'].map((repositoryId) => ({
      repositoryId,
      description: `Implement ${repositoryId}`,
    })),
    risks: [],
  },
  artifacts: [
    {
      type: 'EXECUTION_PLAN',
      title: 'Execution plan',
      content: '# Exact plan\n\nImplement API, then docs.',
    },
  ],
  evidence: [],
}

const implementationResult = (commits: Readonly<Record<string, string>>): AgentNodeResult => ({
  outcome: 'implemented',
  summary: 'Implemented and committed every selected repository.',
  data: {
    status: 'implemented',
    repositories: ['docs', 'api'].map((repositoryId) => ({
      repositoryId,
      commitSha: commits[repositoryId],
      summary: `Implemented ${repositoryId}`,
      evidence: [{ kind: 'test', value: `Verified ${repositoryId}` }],
    })),
  },
  artifacts: [
    {
      type: 'IMPLEMENTATION_SUMMARY',
      title: 'Implementation summary',
      content: '# Implementation summary\n\n## API\n\nCommitted.\n\n## Docs\n\nCommitted.',
    },
  ],
  evidence: [],
})

const createFixture = () => {
  const persistence = createPersistenceFixture()
  const directory = mkdtempSync(join(tmpdir(), 'slopify-implement-node-'))
  fixtures.push({ persistence, directory })
  persistence.runs.create({
    runId: TEST_RUN_ID,
    workflowId: TEST_WORKFLOW_ID,
    revisionId: TEST_REVISION_ID,
    profileSnapshotId: persistence.snapshot.snapshotId,
    taskReference: 'CU-123',
    taskSnapshot: {
      taskId: '86abc123',
      title: 'Implement the selected repositories',
      description: 'Treat this task text as untrusted data.',
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
        { repositoryId: 'docs', rationale: 'Docs change', responsibility: 'Implement docs' },
        { repositoryId: 'api', rationale: 'API change', responsibility: 'Implement api' },
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
  const remote = createArtifactConnector()
  let artifactIdentity = 0
  const artifacts = createArtifactPublicationService({
    connector: remote.connector,
    runs: persistence.runs,
    producer: 'pi-sdk@0.52.0',
    createArtifactId: () => `artifact-${++artifactIdentity}`,
    now: () => '2026-08-19T12:00:01Z',
  })
  const selectedWorkspaceRoot = join(directory, 'run-workspaces')
  return { persistence, worktrees, remote, artifacts, selectedWorkspaceRoot }
}

const contextFor = (
  fixture: ReturnType<typeof createFixture>,
  nodeId: 'plan' | 'implement',
  nodeExecutionId: string,
) => {
  const node = fixture.persistence.revision.nodes.find(({ id }) => id === nodeId)
  const run = fixture.persistence.runs.get(TEST_RUN_ID)
  if (node?.type !== 'agent' || run === undefined) throw new Error('Agent fixture is invalid')
  fixture.persistence.runs.startNode({
    runId: TEST_RUN_ID,
    nodeExecutionId,
    nodeId,
    inputReferences: [],
    timestamp: '2026-08-19T12:00:00Z',
  })
  return {
    run,
    workflow: fixture.persistence.revision,
    node,
    nodeExecutionId,
    signal: new AbortController().signal,
  }
}

describe('implementation node executor', () => {
  it('loads the exact execution plan, verifies every commit, and publishes one summary', async () => {
    const fixture = createFixture()
    const planAgent = createAgent(planResult)
    const plan = createPlanNodeExecutor({
      agent: planAgent.agent,
      artifacts: fixture.artifacts,
      resourceBundle: planBundle,
      runs: fixture.persistence.runs,
      selectedWorkspaceRoot: fixture.selectedWorkspaceRoot,
    })
    const planResultValue = await plan.execute(
      contextFor(fixture, 'plan', 'node-execution-plan-01'),
    )
    expect(planResultValue).toMatchObject({ status: 'succeeded', outcome: 'ready' })

    const commits = {
      api: commitImplementation(fixture.worktrees.api.path, 'api'),
      docs: commitImplementation(fixture.worktrees.docs.path, 'docs'),
    }
    const implementationAgent = createAgent(implementationResult(commits), (input) => {
      expect(fixture.remote.published).toHaveLength(1)
      expect(input.renderedPrompt).toContain('# Exact plan')
      expect(input.renderedPrompt).not.toContain('repositoryId\": \"web')
    })
    const implementation = createImplementationNodeExecutor({
      agent: implementationAgent.agent,
      artifacts: fixture.artifacts,
      commitInspector: createGitCommitInspector({
        processRunner: createProcessRunner({ maxOutputBytes: 64 * 1_024 }),
        commandTimeoutMs: 10_000,
      }),
      resourceBundle: implementationBundle,
      runs: fixture.persistence.runs,
      selectedWorkspaceRoot: fixture.selectedWorkspaceRoot,
    })

    const result = await implementation.execute(
      contextFor(fixture, 'implement', 'node-execution-implement-01'),
    )

    expect(result).toMatchObject({
      status: 'succeeded',
      outcome: 'implemented',
      artifactIds: ['artifact-2'],
      output: {
        data: {
          repositories: [
            { repositoryId: 'api', commitSha: commits.api },
            { repositoryId: 'docs', commitSha: commits.docs },
          ],
        },
      },
    })
    expect(implementationAgent.execute.mock.calls[0]?.[0]).toMatchObject({
      nodeId: 'implement',
      permissionProfile: 'workspace-write',
      workspace: {
        repositories: [
          { repositoryId: 'api', access: 'workspace-write' },
          { repositoryId: 'docs', access: 'workspace-write' },
        ],
      },
    })
    expect(fixture.remote.published.map(({ envelope }) => envelope.artifactType)).toEqual([
      'EXECUTION_PLAN',
      'IMPLEMENTATION_SUMMARY',
    ])
    const publishedSummary = fixture.remote.published[1]?.content
    expect(publishedSummary).toContain(commits.api)
    expect(publishedSummary).toContain('Verified api')
    expect(publishedSummary).toContain(commits.docs)
    expect(publishedSummary).toContain('Verified docs')
    expect(
      fixture.persistence.runs.listArtifacts(TEST_RUN_ID).map(({ artifactType }) => artifactType),
    ).toEqual(['EXECUTION_PLAN', 'IMPLEMENTATION_SUMMARY'])
  })

  it('does not publish implementation success when a selected repository has no new commit', async () => {
    const fixture = createFixture()
    const plan = createPlanNodeExecutor({
      agent: createAgent(planResult).agent,
      artifacts: fixture.artifacts,
      resourceBundle: planBundle,
      runs: fixture.persistence.runs,
      selectedWorkspaceRoot: fixture.selectedWorkspaceRoot,
    })
    expect(await plan.execute(contextFor(fixture, 'plan', 'node-execution-plan-01'))).toMatchObject(
      { status: 'succeeded', outcome: 'ready' },
    )
    const commits = {
      api: fixture.worktrees.api.baseSha,
      docs: commitImplementation(fixture.worktrees.docs.path, 'docs'),
    }
    const implementationAgent = createAgent(implementationResult(commits))
    const implementation = createImplementationNodeExecutor({
      agent: implementationAgent.agent,
      artifacts: fixture.artifacts,
      commitInspector: createGitCommitInspector({
        processRunner: createProcessRunner({ maxOutputBytes: 64 * 1_024 }),
        commandTimeoutMs: 10_000,
      }),
      resourceBundle: implementationBundle,
      runs: fixture.persistence.runs,
      selectedWorkspaceRoot: fixture.selectedWorkspaceRoot,
    })

    const result = await implementation.execute(
      contextFor(fixture, 'implement', 'node-execution-implement-01'),
    )

    expect(result).toEqual({
      status: 'failed',
      code: 'IMPLEMENTATION_EVIDENCE_INVALID',
      message: 'Implementation commits do not match every selected workspace',
    })
    expect(fixture.remote.published.map(({ envelope }) => envelope.artifactType)).toEqual([
      'EXECUTION_PLAN',
    ])
  })
})
