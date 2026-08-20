import { describe, expect, it, vi } from 'vitest'

import { createApiClient } from '../lib/api-client'

const runSummary = {
  runId: 'run-newest',
  workflowId: 'delivery-workflow',
  revisionId: 'revision-frozen',
  profileSnapshotId: 'profile-snapshot-frozen',
  profileId: 'local-profile',
  profileDisplayName: 'Local delivery',
  taskReference: 'LOOP-38',
  notes: 'Preserve the historical evidence.',
  taskSnapshot: { title: 'Inspect historical runs' },
  status: 'SUCCEEDED',
  currentNodeId: null,
  createdAt: '2026-08-20T11:00:00Z',
  startedAt: '2026-08-20T11:00:01Z',
  completedAt: '2026-08-20T11:02:01Z',
  durationMs: 120_000,
  failedNodeId: null,
  mergeRequestUrls: ['https://gitlab.example.com/group/project/-/merge_requests/38'],
} as const

describe('run history API client', () => {
  it('loads a validated page without changing the server order', async () => {
    const page = {
      data: [runSummary, { ...runSummary, runId: 'run-older', createdAt: '2026-08-20T10:00:00Z' }],
      pagination: { page: 2, pageSize: 20, totalItems: 22, totalPages: 2 },
    }
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(page))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.listRuns({ page: 2, pageSize: 20 })).resolves.toEqual(page)
    expect(fetchImplementation).toHaveBeenCalledWith('/api/runs?page=2&pageSize=20', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
  })

  it('rejects invalid input before fetching and malformed success payloads', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: [runSummary], pagination: { page: 1 } }))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.listRuns({ page: 0, pageSize: 20 })).rejects.toMatchObject({
      name: 'ZodError',
    })
    expect(fetchImplementation).not.toHaveBeenCalled()

    await expect(client.listRuns({ page: 1, pageSize: 20 })).rejects.toMatchObject({
      name: 'ZodError',
    })
  })
})
