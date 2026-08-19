import { describe, expect, it, vi } from 'vitest'

import { createGitLabFinalizer } from '../src/index.js'

const apiBase = 'a'.repeat(40)
const apiHead = 'b'.repeat(40)
const docsBase = 'c'.repeat(40)
const docsHead = 'd'.repeat(40)

const workspaces = [
  {
    repositoryId: 'api',
    profilePosition: 0,
    repositoryPath: '/repos/api',
    worktreePath: '/worktrees/api',
    remote: 'origin',
    targetBranch: 'main',
    sourceBranch: 'ai/cu-123-run-01',
    baseSha: apiBase,
    createdAt: '2026-08-19T14:00:00Z',
  },
  {
    repositoryId: 'docs',
    profilePosition: 2,
    repositoryPath: '/repos/docs',
    worktreePath: '/worktrees/docs',
    remote: 'origin',
    targetBranch: 'main',
    sourceBranch: 'ai/cu-123-run-01',
    baseSha: docsBase,
    createdAt: '2026-08-19T14:00:00Z',
  },
] as const

const inputWorkspace = (value: (typeof workspaces)[number]) => ({
  repositoryId: value.repositoryId,
  repositoryPath: value.repositoryPath,
  worktreePath: value.worktreePath,
  remote: value.remote,
  targetBranch: value.targetBranch,
  sourceBranch: value.sourceBranch,
  baseSha: value.baseSha,
})

const commandEvidence = (operation: string) => ({
  operation,
  command: { executable: operation.startsWith('glab') ? 'glab' : 'git', arguments: [], cwd: '/' },
  result: {
    status: 'exited' as const,
    exitCode: 0,
    signal: undefined,
    durationMs: 1,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
  },
})

const createFixture = () => {
  const deliveryEvidence: unknown[] = []
  const evidenceWrites: unknown[] = []
  const artifacts = [
    {
      artifactId: 'artifact-implementation',
      artifactType: 'IMPLEMENTATION_SUMMARY',
      metadata: { status: 'completed', taskId: 'CU-123' },
      content: '# Implementation',
    },
    {
      artifactId: 'artifact-review',
      artifactType: 'REVIEW_SUMMARY',
      metadata: { status: 'resolved', taskId: 'CU-123' },
      content: '# Review\n\nNo findings remain.',
    },
  ]
  const runs = {
    get: vi.fn(() => ({
      runId: 'run-01',
      profileSnapshotId: 'snapshot-01',
      taskSnapshot: {
        taskId: 'CU-123',
        title: 'Validate API requests',
        url: 'https://app.clickup.com/t/CU-123',
      },
      status: 'RUNNING',
      currentNodeId: 'finalize-delivery',
    })),
    listSelections: vi.fn(() => [
      { repositoryId: 'api', profilePosition: 0 },
      { repositoryId: 'docs', profilePosition: 2 },
    ]),
    listWorkspaces: vi.fn(() => workspaces),
    listNodeExecutions: vi.fn(() => [
      {
        nodeExecutionId: 'plan-01',
        nodeId: 'plan',
        executionIndex: 1,
        status: 'SUCCEEDED',
        outcome: 'ready',
        output: { data: { status: 'ready', risks: ['Cross-repository response drift.'] } },
      },
      {
        nodeExecutionId: 'implement-01',
        nodeId: 'implement',
        executionIndex: 2,
        status: 'SUCCEEDED',
        outcome: 'implemented',
        output: {
          summary: 'Implemented request validation and its documentation.',
          data: {
            status: 'implemented',
            repositories: [
              {
                repositoryId: 'api',
                summary: 'Added request validation.',
                evidence: [{ kind: 'test', value: 'API tests passed.' }],
              },
              {
                repositoryId: 'docs',
                summary: 'Documented validation responses.',
                evidence: [{ kind: 'test', value: 'Docs lint passed.' }],
              },
            ],
          },
        },
      },
      {
        nodeExecutionId: 'verify-01',
        nodeId: 'verify',
        executionIndex: 3,
        status: 'SUCCEEDED',
        outcome: 'passed',
        output: {
          commandId: 'verify-selected-repositories',
          recordedAt: '2026-08-19T14:00:01Z',
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
                  stdout: 'passed',
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
                  stdout: 'passed',
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
      },
      ...['requirements-review', 'security-review', 'simplification-review'].map(
        (nodeId, index) => ({
          nodeExecutionId: `${nodeId}-01`,
          nodeId,
          executionIndex: index + 4,
          status: 'SUCCEEDED',
          outcome: 'reviewed',
          output: {},
        }),
      ),
      {
        nodeExecutionId: 'aggregate-01',
        nodeId: 'aggregate-review',
        executionIndex: 7,
        status: 'SUCCEEDED',
        outcome: 'clean',
        output: { status: 'clean', reviewPass: 1, findingCount: 0, findings: [] },
      },
      {
        nodeExecutionId: 'finalize-01',
        nodeId: 'finalize-delivery',
        executionIndex: 8,
        status: 'RUNNING',
        outcome: null,
        output: null,
      },
    ]),
    listArtifacts: vi.fn(() => artifacts),
    listDeliveryEvidence: vi.fn(() => deliveryEvidence),
    upsertDeliveryEvidence: vi.fn((input) => {
      evidenceWrites.push(input)
      const index = deliveryEvidence.findIndex(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          'repositoryId' in item &&
          item.repositoryId === input.repositoryId,
      )
      if (index === -1) deliveryEvidence.push(input)
      else deliveryEvidence[index] = input
    }),
  }
  const profiles = {
    getSnapshot: vi.fn(() => ({
      snapshotId: 'snapshot-01',
      profileId: 'profile-01',
      repositories: [
        {
          repositoryId: 'api',
          profilePosition: 0,
          displayName: 'API',
          gitlabProject: 'group/api',
          mergeRequestLabels: ['backend'],
        },
        {
          repositoryId: 'docs',
          profilePosition: 2,
          displayName: 'Documentation',
          gitlabProject: 'group/docs',
          mergeRequestLabels: [],
        },
      ],
    })),
  }
  const heads = new Map([
    ['api', apiHead],
    ['docs', docsHead],
  ])
  const git = {
    inspect: vi.fn(async (workspace) => ({
      status: 'succeeded' as const,
      value: { headSha: heads.get(workspace.repositoryId) },
      evidence: [commandEvidence(`git-inspect-${workspace.repositoryId}`)],
    })),
    push: vi.fn(async (workspace) => ({
      status: 'succeeded' as const,
      value: true as const,
      evidence: commandEvidence(`git-push-${workspace.repositoryId}`),
    })),
  }
  const mergeRequests = new Map<string, unknown>()
  const createInputs: unknown[] = []
  const glab = {
    listOpenMergeRequests: vi.fn(async ({ project }) => ({
      status: 'succeeded' as const,
      value: mergeRequests.has(project) ? [mergeRequests.get(project)] : [],
      evidence: commandEvidence(`glab-list-${project}`),
    })),
    createMergeRequest: vi.fn(async (input) => {
      createInputs.push(input)
      const repositoryId = input.project.endsWith('/api') ? 'api' : 'docs'
      mergeRequests.set(input.project, {
        iid: repositoryId === 'api' ? 17 : 18,
        url: `https://gitlab.example/${input.project}/-/merge_requests/${repositoryId === 'api' ? 17 : 18}`,
        state: 'opened',
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        headSha: heads.get(repositoryId),
      })
      return {
        status: 'succeeded' as const,
        value: true as const,
        evidence: commandEvidence(`glab-create-${input.project}`),
      }
    }),
  }
  return { artifacts, createInputs, evidenceWrites, git, glab, mergeRequests, profiles, runs }
}

describe('ordered GitLab finalizer', () => {
  it('pushes and verifies one merge request per repository in profile order', async () => {
    const fixture = createFixture()
    const finalizer = createGitLabFinalizer({
      profiles: fixture.profiles,
      runs: fixture.runs,
      git: fixture.git,
      glab: fixture.glab,
      now: () => '2026-08-19T14:00:05Z',
    })

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: 'CU-123',
      workspaces: [inputWorkspace(workspaces[1]), inputWorkspace(workspaces[0])],
    })

    expect(result).toMatchObject({
      status: 'succeeded',
      evidence: [
        {
          repositoryId: 'api',
          project: 'group/api',
          iid: 17,
          state: 'opened',
          sourceBranch: 'ai/cu-123-run-01',
          targetBranch: 'main',
          baseSha: apiBase,
          headSha: apiHead,
        },
        {
          repositoryId: 'docs',
          project: 'group/docs',
          iid: 18,
          state: 'opened',
          sourceBranch: 'ai/cu-123-run-01',
          targetBranch: 'main',
          baseSha: docsBase,
          headSha: docsHead,
        },
      ],
    })
    expect(fixture.git.push.mock.calls.map(([workspace]) => workspace.repositoryId)).toEqual([
      'api',
      'docs',
    ])
    expect(fixture.createInputs).toMatchObject([
      {
        project: 'group/api',
        title: '[CU-123] Validate API requests',
        labels: ['backend'],
      },
      {
        project: 'group/docs',
        title: '[CU-123] Validate API requests',
        labels: [],
      },
    ])
    expect(fixture.createInputs[0]).toMatchObject({
      description: expect.stringContaining('## Verification'),
    })
    expect(fixture.createInputs[0]).toMatchObject({
      description: expect.stringContaining('## Risks'),
    })
    expect(fixture.createInputs[0]).toMatchObject({
      description: expect.stringContaining('## Rollback'),
    })
    expect(
      fixture.evidenceWrites.map(({ repositoryId, status }) => ({ repositoryId, status })),
    ).toEqual([
      { repositoryId: 'api', status: 'BRANCH_PUSHED' },
      { repositoryId: 'api', status: 'MERGE_REQUEST_CREATED' },
      { repositoryId: 'api', status: 'VERIFIED' },
      { repositoryId: 'docs', status: 'BRANCH_PUSHED' },
      { repositoryId: 'docs', status: 'MERGE_REQUEST_CREATED' },
      { repositoryId: 'docs', status: 'VERIFIED' },
    ])
    expect(fixture.evidenceWrites).toContainEqual(
      expect.objectContaining({
        repositoryId: 'api',
        status: 'VERIFIED',
        evidence: expect.objectContaining({
          identity: expect.objectContaining({ baseSha: apiBase, headSha: apiHead }),
        }),
      }),
    )
  })

  it('discovers duplicates for the complete selected set before any push', async () => {
    const fixture = createFixture()
    fixture.mergeRequests.set('group/docs', {
      iid: 18,
      url: 'https://gitlab.example/group/docs/-/merge_requests/18',
      state: 'opened',
      sourceBranch: 'ai/cu-123-run-01',
      targetBranch: 'main',
      headSha: docsHead,
    })
    const finalizer = createGitLabFinalizer({
      profiles: fixture.profiles,
      runs: fixture.runs,
      git: fixture.git,
      glab: fixture.glab,
    })

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: 'CU-123',
      workspaces: workspaces.map(inputWorkspace),
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'DELIVERY_DUPLICATE_MERGE_REQUEST', repositoryId: 'docs' },
      partialEvidence: [],
    })
    expect(fixture.git.push).not.toHaveBeenCalled()
    expect(fixture.glab.createMergeRequest).not.toHaveBeenCalled()
    expect(fixture.evidenceWrites).toEqual([])
  })

  it('preserves a verified earlier merge request when a later push fails without retrying', async () => {
    const fixture = createFixture()
    fixture.git.push.mockImplementation(async (workspace) =>
      workspace.repositoryId === 'docs'
        ? {
            status: 'failed' as const,
            failure: { evidence: { operation: 'push', stderr: 'rejected' } },
          }
        : {
            status: 'succeeded' as const,
            value: true as const,
            evidence: commandEvidence('git-push-api'),
          },
    )
    const finalizer = createGitLabFinalizer({
      profiles: fixture.profiles,
      runs: fixture.runs,
      git: fixture.git,
      glab: fixture.glab,
      now: () => '2026-08-19T14:00:05Z',
    })

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: 'CU-123',
      workspaces: workspaces.map(inputWorkspace),
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'DELIVERY_PUSH_FAILED', repositoryId: 'docs' },
      partialEvidence: [
        {
          repositoryId: 'api',
          project: 'group/api',
          iid: 17,
          headSha: apiHead,
        },
      ],
    })
    expect(fixture.git.push).toHaveBeenCalledTimes(2)
    expect(fixture.glab.createMergeRequest).toHaveBeenCalledTimes(1)
    expect(
      fixture.evidenceWrites.map(({ repositoryId, status }) => ({ repositoryId, status })),
    ).toEqual([
      { repositoryId: 'api', status: 'BRANCH_PUSHED' },
      { repositoryId: 'api', status: 'MERGE_REQUEST_CREATED' },
      { repositoryId: 'api', status: 'VERIFIED' },
      { repositoryId: 'docs', status: 'FAILED' },
    ])
  })

  it('persists a failed identity after creation when read-back head does not match', async () => {
    const fixture = createFixture()
    fixture.glab.createMergeRequest.mockImplementation(async (input) => {
      fixture.mergeRequests.set(input.project, {
        iid: 17,
        url: `https://gitlab.example/${input.project}/-/merge_requests/17`,
        state: 'opened',
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        headSha: 'e'.repeat(40),
      })
      return {
        status: 'succeeded' as const,
        value: true as const,
        evidence: commandEvidence(`glab-create-${input.project}`),
      }
    })
    const finalizer = createGitLabFinalizer({
      profiles: fixture.profiles,
      runs: fixture.runs,
      git: fixture.git,
      glab: fixture.glab,
      now: () => '2026-08-19T14:00:05Z',
    })

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: 'CU-123',
      workspaces: workspaces.map(inputWorkspace),
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'DELIVERY_MERGE_REQUEST_READBACK_FAILED', repositoryId: 'api' },
      partialEvidence: [],
    })
    expect(fixture.git.push).toHaveBeenCalledTimes(1)
    expect(fixture.glab.createMergeRequest).toHaveBeenCalledTimes(1)
    expect(fixture.evidenceWrites).toMatchObject([
      { repositoryId: 'api', status: 'BRANCH_PUSHED' },
      { repositoryId: 'api', status: 'MERGE_REQUEST_CREATED' },
      { repositoryId: 'api', status: 'FAILED' },
    ])
  })

  it('returns the verified external identity when its persistence write fails', async () => {
    const fixture = createFixture()
    fixture.runs.upsertDeliveryEvidence.mockImplementation((input) => {
      fixture.evidenceWrites.push(input)
      if (input.repositoryId === 'api' && input.status === 'VERIFIED') {
        throw new Error('storage unavailable')
      }
    })
    const finalizer = createGitLabFinalizer({
      profiles: fixture.profiles,
      runs: fixture.runs,
      git: fixture.git,
      glab: fixture.glab,
      now: () => '2026-08-19T14:00:05Z',
    })

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: 'CU-123',
      workspaces: workspaces.map(inputWorkspace),
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'DELIVERY_PERSISTENCE_FAILED',
        repositoryId: 'api',
        evidence: expect.objectContaining({
          identity: expect.objectContaining({
            project: 'group/api',
            iid: 17,
            baseSha: apiBase,
            headSha: apiHead,
          }),
        }),
      },
      partialEvidence: [
        expect.objectContaining({
          repositoryId: 'api',
          project: 'group/api',
          iid: 17,
          baseSha: apiBase,
          headSha: apiHead,
        }),
      ],
    })
    expect(fixture.git.push).toHaveBeenCalledTimes(1)
    expect(fixture.glab.createMergeRequest).toHaveBeenCalledTimes(1)
  })

  it('rejects unresolved review evidence before inspecting or mutating GitLab', async () => {
    const fixture = createFixture()
    const review = fixture.artifacts.find(({ artifactType }) => artifactType === 'REVIEW_SUMMARY')
    if (review === undefined) throw new Error('Review fixture is missing')
    review.metadata.status = 'changes-requested'
    const finalizer = createGitLabFinalizer({
      profiles: fixture.profiles,
      runs: fixture.runs,
      git: fixture.git,
      glab: fixture.glab,
    })

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: 'CU-123',
      workspaces: workspaces.map(inputWorkspace),
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'DELIVERY_ARTIFACT_INVALID' },
      partialEvidence: [],
    })
    expect(fixture.git.inspect).not.toHaveBeenCalled()
    expect(fixture.glab.listOpenMergeRequests).not.toHaveBeenCalled()
  })
})
