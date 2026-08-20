// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RunsPage from '../app/runs/page'
import { RunHistory } from '../components/runs/run-history'
import { createApiClient, type ApiClient, type RunHistoryPage } from '../lib/api-client'

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

afterEach(cleanup)

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

describe('run history page', () => {
  it('normalizes URL pagination before crossing the client boundary', async () => {
    const valid = await RunsPage({ searchParams: Promise.resolve({ page: '3' }) })
    const invalid = await RunsPage({ searchParams: Promise.resolve({ page: ['3', '4'] }) })

    expect(valid).toMatchObject({ props: { page: 3 } })
    expect(invalid).toMatchObject({ props: { page: 1 } })
  })

  it('renders server-ordered identity, timing, stopped-node, and created-MR evidence', async () => {
    const page = {
      data: [
        runSummary,
        {
          ...runSummary,
          runId: 'run-older',
          taskReference: 'LOOP-37',
          taskSnapshot: { title: 'Follow a live run' },
          status: 'FAILED' as const,
          createdAt: '2026-08-20T10:00:00Z',
          durationMs: 12_000,
          failedNodeId: 'verify',
          mergeRequestUrls: [],
        },
      ],
      pagination: { page: 2, pageSize: 20, totalItems: 22, totalPages: 2 },
    }
    const listRuns = vi.fn<ApiClient['listRuns']>(async () => page as unknown as RunHistoryPage)

    render(<RunHistory client={{ listRuns }} page={2} />)

    const runLinks = await screen.findAllByRole('link', { name: /^Open run/ })
    expect(runLinks.map((link) => link.textContent)).toEqual([
      'Inspect historical runs',
      'Follow a live run',
    ])
    expect(screen.getAllByText('Local delivery · local-profile')).toHaveLength(2)
    expect(screen.getAllByText('revision-frozen')).toHaveLength(2)
    expect(screen.getByText('2m 0s')).toBeTruthy()
    expect(screen.getByText('Stopped at verify')).toBeTruthy()

    const mergeRequest = screen.getByRole('link', { name: 'Created merge request 1 for LOOP-38' })
    expect(mergeRequest.getAttribute('href')).toBe(
      'https://gitlab.example.com/group/project/-/merge_requests/38',
    )
    expect(
      screen.getByText(
        'Created merge requests do not confirm pipeline success, approval, merge, deployment, or release.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Previous page' }).getAttribute('href')).toBe(
      '/runs?page=1',
    )
    expect(screen.queryByRole('link', { name: 'Next page' })).toBeNull()
    expect(listRuns).toHaveBeenCalledWith({ page: 2, pageSize: 20 })
  })

  it('renders explicit empty and failure states', async () => {
    const empty = vi.fn<ApiClient['listRuns']>(async () => ({
      data: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    }))
    const { rerender } = render(<RunHistory client={{ listRuns: empty }} page={1} />)

    expect(await screen.findByText('No runs yet')).toBeTruthy()

    const failed = vi.fn<ApiClient['listRuns']>(async () => {
      throw new Error('unavailable')
    })
    rerender(<RunHistory client={{ listRuns: failed }} page={2} />)

    expect((await screen.findByRole('alert')).textContent).toContain('Run history unavailable')
  })
})
