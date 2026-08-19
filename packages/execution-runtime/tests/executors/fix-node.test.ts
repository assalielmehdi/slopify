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
  createFixNodeExecutor,
  createGitFindingResolutionInspector,
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

const resolutionBundle: LoadedResourceBundle = {
  bundleId: 'finding-resolution-v1',
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
  writeFileSync(join(path, 'implementation.txt'), `${repositoryId} implementation\n`)
  git(path, 'add', 'implementation.txt')
  git(path, 'commit', '-m', `Implement ${repositoryId}`)
  return { path, sourceBranch, baseSha, headSha: git(path, 'rev-parse', 'HEAD') }
}

const terminalEvent = (input: AgentExecutionInput, result: AgentNodeResult) =>
  AgentExecutionEventSchema.parse({
    executionId: input.executionId,
    runId: input.runId,
    nodeId: input.nodeId,
    timestamp: '2026-08-19T13:00:03Z',
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

const createConnector = (): ArtifactConnector => ({
  async publishArtifact() {
    throw new Error('Unexpected artifact publication')
  },
  async getArtifact() {
    throw new Error('Artifact not found')
  },
})

const createFixture = () => {
  const persistence = createPersistenceFixture()
  const directory = mkdtempSync(join(tmpdir(), 'slopify-fix-node-'))
  fixtures.push({ persistence, directory })
  persistence.runs.create({
    runId: TEST_RUN_ID,
    workflowId: TEST_WORKFLOW_ID,
    revisionId: TEST_REVISION_ID,
    profileSnapshotId: persistence.snapshot.snapshotId,
    taskReference: 'CU-123',
    taskSnapshot: {
      taskId: '86abc123',
      title: 'Fix the exact failed verification',
      description: 'Resolve only the current failure in the selected repositories.',
    },
    effectiveConfiguration: persistence.revision,
    createdAt: TEST_TIMESTAMP,
  })
  persistence.runs.changeStatus({
    runId: TEST_RUN_ID,
    expectedStatus: 'PENDING',
    status: 'RUNNING',
    timestamp: '2026-08-19T13:00:00Z',
  })
  persistence.runs.selectRepositories({
    runId: TEST_RUN_ID,
    selectedAt: '2026-08-19T13:00:00Z',
    selection: {
      selected: [
        { repositoryId: 'docs', rationale: 'Docs selected', responsibility: 'Maintain docs' },
        { repositoryId: 'api', rationale: 'API selected', responsibility: 'Maintain API' },
      ],
      excluded: [{ repositoryId: 'web', rationale: 'No frontend change' }],
    },
  })
  const root = join(directory, 'worktrees')
  const worktrees = {
    api: createWorktree(root, 'api'),
    docs: createWorktree(root, 'docs'),
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
      createdAt: '2026-08-19T13:00:00Z',
    })
  }
  const artifacts = createArtifactPublicationService({
    connector: createConnector(),
    runs: persistence.runs,
    producer: 'aggregate-review-findings',
  })
  const inspector = createGitFindingResolutionInspector({
    processRunner: createProcessRunner({ maxOutputBytes: 64 * 1_024 }),
    commandTimeoutMs: 10_000,
  })
  return {
    persistence,
    directory,
    worktrees,
    artifacts,
    inspector,
    selectedWorkspaceRoot: join(directory, 'run-workspaces'),
  }
}

const recordFailedVerification = (fixture: ReturnType<typeof createFixture>) => {
  fixture.persistence.runs.startNode({
    runId: TEST_RUN_ID,
    nodeExecutionId: 'node-execution-verify-01',
    nodeId: 'verify',
    inputReferences: [],
    timestamp: '2026-08-19T13:00:01Z',
  })
  fixture.persistence.runs.completeNode({
    runId: TEST_RUN_ID,
    nodeExecutionId: 'node-execution-verify-01',
    nodeId: 'verify',
    outcome: 'failed-checks',
    durationMs: 10,
    artifactIds: [],
    output: {
      commandId: 'verify-selected-repositories',
      recordedAt: '2026-08-19T13:00:02Z',
      repositories: [
        {
          repositoryId: 'api',
          profilePosition: 0,
          status: 'failed',
          commands: [
            {
              commandIndex: 0,
              command: { executable: 'pnpm', arguments: ['test'] },
              status: 'failed',
              processStatus: 'exited',
              exitCode: 1,
              signal: null,
              durationMs: 5,
              stdout: 'API contract assertion failed',
              stderr: 'Expected status 422 but received 500',
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
              stdout: 'Docs lint passed',
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
        passedCommandCount: 1,
        failedCommandCount: 1,
      },
    },
    timestamp: '2026-08-19T13:00:02Z',
  })
}

const contextFor = (fixture: ReturnType<typeof createFixture>) => {
  const node = fixture.persistence.revision.nodes.find(({ id }) => id === 'fix-findings')
  const run = fixture.persistence.runs.get(TEST_RUN_ID)
  if (node?.type !== 'agent' || run === undefined) throw new Error('Fix fixture is invalid')
  fixture.persistence.runs.startNode({
    runId: TEST_RUN_ID,
    nodeExecutionId: 'node-execution-fix-01',
    nodeId: node.id,
    inputReferences: [],
    timestamp: '2026-08-19T13:00:03Z',
  })
  return {
    run,
    workflow: fixture.persistence.revision,
    node,
    nodeExecutionId: 'node-execution-fix-01',
    signal: new AbortController().signal,
  }
}

describe('fix findings node', () => {
  it('fixes exact failed verification evidence without inventing a review artifact', async () => {
    const fixture = createFixture()
    recordFailedVerification(fixture)
    const inputs: AgentExecutionInput[] = []
    const agent: AgentExecutor = {
      execute: vi.fn<AgentExecutor['execute']>((input) =>
        (async function* () {
          inputs.push(input)
          writeFileSync(
            join(fixture.worktrees.api.path, 'fix.txt'),
            'Return the expected validation status\n',
          )
          git(fixture.worktrees.api.path, 'add', 'fix.txt')
          git(fixture.worktrees.api.path, 'commit', '-m', 'Fix validation status')
          const apiHeadSha = git(fixture.worktrees.api.path, 'rev-parse', 'HEAD')
          const result: AgentNodeResult = {
            outcome: 'fixed',
            summary: 'Resolved the failed API verification.',
            data: {
              status: 'fixed',
              source: 'failed-verification',
              repositories: [
                {
                  repositoryId: 'docs',
                  status: 'unchanged',
                  headSha: fixture.worktrees.docs.headSha,
                  summary: 'No failed docs evidence required a change.',
                  evidence: [{ kind: 'test', value: 'Docs lint was already passing.' }],
                },
                {
                  repositoryId: 'api',
                  status: 'changed',
                  previousHeadSha: fixture.worktrees.api.headSha,
                  commitSha: apiHeadSha,
                  summary: 'Corrected validation status handling.',
                  evidence: [{ kind: 'test', value: 'Targeted API assertion now passes.' }],
                },
              ],
            },
            artifacts: [],
            evidence: [],
          }
          yield terminalEvent(input, result)
        })(),
      ),
      cancel: vi.fn<AgentExecutor['cancel']>(async () => ({ status: 'cancelled' })),
    }
    const executor = createFixNodeExecutor({
      agent,
      artifacts: fixture.artifacts,
      inspector: fixture.inspector,
      resourceBundle: resolutionBundle,
      runs: fixture.persistence.runs,
      selectedWorkspaceRoot: fixture.selectedWorkspaceRoot,
    })

    const result = await executor.execute(contextFor(fixture))

    expect(result).toMatchObject({
      status: 'succeeded',
      outcome: 'fixed',
      artifactIds: [],
      output: {
        data: {
          status: 'fixed',
          source: 'failed-verification',
          repositories: [
            {
              repositoryId: 'api',
              status: 'changed',
              previousHeadSha: fixture.worktrees.api.headSha,
              commitSha: git(fixture.worktrees.api.path, 'rev-parse', 'HEAD'),
            },
            {
              repositoryId: 'docs',
              status: 'unchanged',
              headSha: fixture.worktrees.docs.headSha,
            },
          ],
        },
      },
    })
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({
      nodeId: 'fix-findings',
      permissionProfile: 'workspace-write',
      workspace: {
        repositories: [
          { repositoryId: 'api', access: 'workspace-write' },
          { repositoryId: 'docs', access: 'workspace-write' },
        ],
      },
    })
    expect(inputs[0]?.renderedPrompt).toContain('failed-verification')
    expect(inputs[0]?.renderedPrompt).toContain('API contract assertion failed')
    expect(inputs[0]?.renderedPrompt).toContain('Expected status 422 but received 500')
    expect(inputs[0]?.renderedPrompt).toContain(fixture.worktrees.api.headSha)
    expect(inputs[0]?.renderedPrompt).toContain('## Required prior artifacts\n\n```json\n[]')
    expect(inputs[0]?.renderedPrompt).not.toContain('repositoryId\": \"web')
    expect(git(fixture.worktrees.api.path, 'status', '--porcelain=v1')).toBe('')
    expect(git(fixture.worktrees.docs.path, 'rev-parse', 'HEAD')).toBe(
      fixture.worktrees.docs.headSha,
    )
    expect(fixture.persistence.runs.listArtifacts(TEST_RUN_ID)).toEqual([])
  })
})
