import { describe, expect, it, vi } from 'vitest'

import { createClickUpFinalizer } from '../src/index.js'

const apiBase = 'a'.repeat(40)
const apiHead = 'b'.repeat(40)
const docsBase = 'c'.repeat(40)
const docsHead = 'd'.repeat(40)

const mergeRequests = [
  {
    repositoryId: 'api',
    project: 'group/api',
    iid: 17,
    url: 'https://gitlab.example/group/api/-/merge_requests/17',
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
    url: 'https://gitlab.example/group/docs/-/merge_requests/18',
    state: 'opened',
    sourceBranch: 'ai/cu-123-run-01',
    targetBranch: 'main',
    baseSha: docsBase,
    headSha: docsHead,
  },
] as const

const createFixture = () => {
  const calls: string[] = []
  const runs = {
    get: vi.fn(() => ({
      runId: 'run-01',
      workflowId: 'delivery-workflow',
      revisionId: 'revision-01',
      profileSnapshotId: 'snapshot-01',
      taskSnapshot: {
        taskId: '86abc123',
        title: 'Validate API requests',
        url: 'https://app.clickup.com/t/86abc123',
      },
      status: 'RUNNING',
      currentNodeId: 'finalize-delivery',
    })),
    listSelections: vi.fn(() => [
      { repositoryId: 'api', profilePosition: 0 },
      { repositoryId: 'docs', profilePosition: 2 },
    ]),
    listWorkspaces: vi.fn(() => [
      { repositoryId: 'api', profilePosition: 0, baseSha: apiBase },
      { repositoryId: 'docs', profilePosition: 2, baseSha: docsBase },
    ]),
    listDeliveryEvidence: vi.fn(() =>
      mergeRequests.map((mergeRequest, index) => ({
        repositoryId: mergeRequest.repositoryId,
        profilePosition: index === 0 ? 0 : 2,
        status: 'VERIFIED',
        gitlabProject: mergeRequest.project,
        mergeRequestIid: mergeRequest.iid,
        mergeRequestUrl: mergeRequest.url,
        sourceBranch: mergeRequest.sourceBranch,
        targetBranch: mergeRequest.targetBranch,
        headSha: mergeRequest.headSha,
      })),
    ),
  }
  const profiles = {
    getSnapshot: vi.fn(() => ({
      clickupInReviewStatusId: 'status-in-review',
      repositories: [
        { repositoryId: 'api', profilePosition: 0, gitlabProject: 'group/api' },
        { repositoryId: 'docs', profilePosition: 2, gitlabProject: 'group/docs' },
      ],
    })),
  }
  const clickup = {
    publishArtifact: vi.fn(async (input) => {
      calls.push('publish')
      return {
        taskId: input.taskId,
        commentId: 'finalization-comment-01',
        author: 'Workflow Connector',
        createdAt: '2026-08-19T15:00:00Z',
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
    }),
    moveToInReview: vi.fn(async (taskId) => {
      calls.push('status')
      return {
        taskId,
        customTaskId: null,
        url: `https://app.clickup.com/t/${taskId}`,
        title: 'Validate API requests',
        description: 'Task description',
        status: { id: 'status-in-review', name: 'in review', type: 'custom' },
        priority: null,
        comments: [],
        resourceLinks: [],
      }
    }),
  }
  return { calls, clickup, profiles, runs }
}

describe('ClickUp delivery finalization', () => {
  it('finalizes a single selected repository with the same guarded ordering', async () => {
    const fixture = createFixture()
    fixture.runs.listSelections.mockReturnValue([{ repositoryId: 'api', profilePosition: 0 }])
    fixture.runs.listWorkspaces.mockReturnValue([
      { repositoryId: 'api', profilePosition: 0, baseSha: apiBase },
    ])
    fixture.runs.listDeliveryEvidence.mockReturnValue([
      {
        repositoryId: 'api',
        profilePosition: 0,
        status: 'VERIFIED',
        gitlabProject: 'group/api',
        mergeRequestIid: 17,
        mergeRequestUrl: mergeRequests[0].url,
        sourceBranch: mergeRequests[0].sourceBranch,
        targetBranch: mergeRequests[0].targetBranch,
        headSha: apiHead,
      },
    ])
    fixture.profiles.getSnapshot.mockReturnValue({
      clickupInReviewStatusId: 'status-in-review',
      repositories: [{ repositoryId: 'api', profilePosition: 0, gitlabProject: 'group/api' }],
    })
    const finalizer = createClickUpFinalizer(fixture)

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: '86abc123',
      mergeRequests: [mergeRequests[0]],
    })

    expect(result).toMatchObject({
      status: 'succeeded',
      mergeRequests: [mergeRequests[0]],
    })
    expect(fixture.calls).toEqual(['publish', 'status'])
    const content = fixture.clickup.publishArtifact.mock.calls[0]?.[0].content ?? ''
    expect(content).toContain('### api')
    expect(content).not.toContain('### docs')
  })

  it('publishes one ordered complete artifact before moving the task to In Review', async () => {
    const fixture = createFixture()
    const finalizer = createClickUpFinalizer(fixture)

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: '86abc123',
      mergeRequests,
    })

    expect(result).toMatchObject({
      status: 'succeeded',
      mergeRequests,
      artifact: {
        commentId: 'finalization-comment-01',
        envelope: { artifactType: 'FINALIZATION', status: 'completed' },
      },
      task: { taskId: '86abc123', status: { id: 'status-in-review' } },
    })
    expect(fixture.calls).toEqual(['publish', 'status'])
    expect(fixture.clickup.publishArtifact).toHaveBeenCalledTimes(1)
    expect(fixture.clickup.publishArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: '86abc123',
        runId: 'run-01',
        workflowId: 'delivery-workflow',
        revisionId: 'revision-01',
        nodeId: 'finalize-delivery',
        artifactType: 'FINALIZATION',
        producer: 'finalize-gitlab-delivery',
        status: 'completed',
      }),
    )
    const content = fixture.clickup.publishArtifact.mock.calls[0]?.[0].content ?? ''
    expect(content.indexOf('### api')).toBeLessThan(content.indexOf('### docs'))
    expect(content).toContain(mergeRequests[0].url)
    expect(content).toContain(apiBase)
    expect(content).toContain(apiHead)
    expect(content).toContain(mergeRequests[1].url)
    expect(content).toContain(docsBase)
    expect(content).toContain(docsHead)
  })

  it('rejects an incomplete merge request set before any ClickUp mutation', async () => {
    const fixture = createFixture()
    const finalizer = createClickUpFinalizer(fixture)

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: '86abc123',
      mergeRequests: [mergeRequests[0]],
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'DELIVERY_CLICKUP_EVIDENCE_INCOMPLETE' },
      mergeRequests: [mergeRequests[0]],
    })
    expect(fixture.calls).toEqual([])
  })

  it('retains the complete GitLab evidence when publication fails without moving status', async () => {
    const fixture = createFixture()
    fixture.clickup.publishArtifact.mockRejectedValueOnce(new Error('comment failed'))
    const finalizer = createClickUpFinalizer(fixture)

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: '86abc123',
      mergeRequests,
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'DELIVERY_CLICKUP_ARTIFACT_FAILED' },
      mergeRequests,
    })
    expect(fixture.clickup.publishArtifact).toHaveBeenCalledTimes(1)
    expect(fixture.clickup.moveToInReview).not.toHaveBeenCalled()
  })

  it('does not move status when artifact readback identity is inconsistent', async () => {
    const fixture = createFixture()
    const publish = fixture.clickup.publishArtifact.getMockImplementation()
    if (publish === undefined) throw new Error('Publish fixture is missing')
    fixture.clickup.publishArtifact.mockImplementationOnce(async (input) => ({
      ...(await publish(input)),
      content: '# Wrong finalization',
    }))
    const finalizer = createClickUpFinalizer(fixture)

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: '86abc123',
      mergeRequests,
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'DELIVERY_CLICKUP_ARTIFACT_FAILED' },
      mergeRequests,
      artifact: { content: '# Wrong finalization' },
    })
    expect(fixture.clickup.moveToInReview).not.toHaveBeenCalled()
  })

  it('rejects persisted merge request identity drift before publishing', async () => {
    const fixture = createFixture()
    const evidence = fixture.runs.listDeliveryEvidence()
    fixture.runs.listDeliveryEvidence.mockReturnValue([
      evidence[0],
      { ...evidence[1], headSha: 'e'.repeat(40) },
    ])
    const finalizer = createClickUpFinalizer(fixture)

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: '86abc123',
      mergeRequests,
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'DELIVERY_CLICKUP_EVIDENCE_INCOMPLETE' },
      mergeRequests,
    })
    expect(fixture.calls).toEqual([])
  })

  it('retains the artifact and complete GitLab evidence when status movement fails', async () => {
    const fixture = createFixture()
    fixture.clickup.moveToInReview.mockRejectedValueOnce(new Error('status failed'))
    const finalizer = createClickUpFinalizer(fixture)

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: '86abc123',
      mergeRequests,
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'DELIVERY_CLICKUP_STATUS_FAILED' },
      mergeRequests,
      artifact: { commentId: 'finalization-comment-01' },
    })
    expect(fixture.calls).toEqual(['publish'])
    expect(fixture.clickup.moveToInReview).toHaveBeenCalledTimes(1)
  })

  it('fails when status readback does not match the immutable profile snapshot', async () => {
    const fixture = createFixture()
    const move = fixture.clickup.moveToInReview.getMockImplementation()
    if (move === undefined) throw new Error('Status fixture is missing')
    fixture.clickup.moveToInReview.mockImplementationOnce(async (taskId) => {
      const task = await move(taskId)
      return { ...task, status: { id: 'other-status', name: 'other', type: 'custom' } }
    })
    const finalizer = createClickUpFinalizer(fixture)

    const result = await finalizer.finalize({
      runId: 'run-01',
      taskId: '86abc123',
      mergeRequests,
    })

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'DELIVERY_CLICKUP_STATUS_FAILED' },
      mergeRequests,
      artifact: { commentId: 'finalization-comment-01' },
    })
    expect(fixture.clickup.moveToInReview).toHaveBeenCalledTimes(1)
  })
})
