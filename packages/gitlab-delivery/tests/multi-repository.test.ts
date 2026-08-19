import { describe, expect, it, vi } from 'vitest'

import { createDeliveryFinalizer } from '../src/index.js'

const input = {
  runId: 'run-01',
  taskId: '86abc123',
  workspaces: [
    {
      repositoryId: 'api',
      repositoryPath: '/repos/api',
      worktreePath: '/worktrees/api',
      remote: 'origin',
      targetBranch: 'main',
      sourceBranch: 'ai/cu-123-run-01',
      baseSha: 'a'.repeat(40),
    },
    {
      repositoryId: 'docs',
      repositoryPath: '/repos/docs',
      worktreePath: '/worktrees/docs',
      remote: 'origin',
      targetBranch: 'main',
      sourceBranch: 'ai/cu-123-run-01',
      baseSha: 'c'.repeat(40),
    },
  ],
} as const

const mergeRequests = input.workspaces.map((workspace, index) => ({
  repositoryId: workspace.repositoryId,
  project: `group/${workspace.repositoryId}`,
  iid: index + 17,
  url: `https://gitlab.example/group/${workspace.repositoryId}/-/merge_requests/${index + 17}`,
  state: 'opened' as const,
  sourceBranch: workspace.sourceBranch,
  targetBranch: workspace.targetBranch,
  baseSha: workspace.baseSha,
  headSha: (index === 0 ? 'b' : 'd').repeat(40),
}))

describe('complete multi-repository finalizer', () => {
  it('invokes ClickUp only after the complete GitLab result succeeds', async () => {
    const calls: string[] = []
    const gitlab = {
      finalize: vi.fn(async () => {
        calls.push('gitlab')
        return { status: 'succeeded' as const, evidence: mergeRequests }
      }),
    }
    const clickup = {
      finalize: vi.fn(async ({ mergeRequests: evidence }) => {
        calls.push('clickup')
        return {
          status: 'succeeded' as const,
          mergeRequests: evidence,
          artifact: { commentId: 'finalization-comment-01' },
          task: { status: { id: 'status-in-review' } },
        }
      }),
    }

    const result = await createDeliveryFinalizer({ gitlab, clickup }).finalize(input)

    expect(result).toMatchObject({ status: 'succeeded', mergeRequests })
    expect(calls).toEqual(['gitlab', 'clickup'])
    expect(clickup.finalize).toHaveBeenCalledWith({
      runId: 'run-01',
      taskId: '86abc123',
      mergeRequests,
    })
  })

  it('does not publish or move ClickUp for a partial GitLab result', async () => {
    const gitlab = {
      finalize: vi.fn(async () => ({
        status: 'failed' as const,
        error: { code: 'DELIVERY_PUSH_FAILED', message: 'Push failed', repositoryId: 'docs' },
        partialEvidence: [mergeRequests[0]],
      })),
    }
    const clickup = { finalize: vi.fn() }

    const result = await createDeliveryFinalizer({ gitlab, clickup }).finalize(input)

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'DELIVERY_PUSH_FAILED', repositoryId: 'docs' },
      partialEvidence: [mergeRequests[0]],
    })
    expect(clickup.finalize).not.toHaveBeenCalled()
  })
})
