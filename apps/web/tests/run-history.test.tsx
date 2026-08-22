// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RunsPage from '../app/runs/page'
import { RunHistory } from '../components/runs/run-history'
import { createApiClient, type ApiClient, type RunHistoryPage } from '../lib/api-client'

const runSummary = {
  runId: 'run-newest',
  workflowId: 'delivery-workflow',
  status: 'SUCCEEDED',
  createdAt: '2026-08-20T11:00:00Z',
  startedAt: '2026-08-20T11:00:01Z',
  completedAt: '2026-08-20T11:02:01Z',
  durationMs: 120_000,
} as const

afterEach(cleanup)

describe('run history API client', () => {
  it('loads a validated page without changing the server order', async () => {
    const page = {
      data: [runSummary, { ...runSummary, runId: 'run-older' }],
      pagination: { page: 2, pageSize: 20, totalItems: 22, totalPages: 2 },
    }
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(page))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.listRuns({ page: 2, pageSize: 20 })).resolves.toEqual(page)
  })
})

describe('run history page', () => {
  it('normalizes URL pagination before crossing the client boundary', async () => {
    const valid = await RunsPage({ searchParams: Promise.resolve({ page: '3' }) })
    const invalid = await RunsPage({ searchParams: Promise.resolve({ page: ['3', '4'] }) })

    expect(valid).toMatchObject({ props: { page: 3 } })
    expect(invalid).toMatchObject({ props: { page: 1 } })
  })

  it('renders exactly run ID, started, duration, and semantic status columns', async () => {
    const listRuns = vi.fn<ApiClient['listRuns']>(
      async () =>
        ({
          data: [
            runSummary,
            {
              ...runSummary,
              runId: 'run-failed',
              status: 'FAILED',
              startedAt: '2026-08-20T10:00:00Z',
              durationMs: 12_000,
            },
          ],
          pagination: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 },
        }) as unknown as RunHistoryPage,
    )

    render(<RunHistory client={{ listRuns }} page={1} />)

    const table = await screen.findByRole('table', { name: 'Workflow runs' })
    expect(Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent)).toEqual([
      'Run ID',
      'Started',
      'Duration',
      'Status',
    ])
    expect(screen.queryByText('Version')).toBeNull()
    expect(screen.queryByRole('search')).toBeNull()
    expect(screen.getByText('Succeeded').className).toContain('text-status-success')
    expect(screen.getByText('Failed').className).toContain('text-destructive')
    expect(screen.getByText('2m 0s')).toBeTruthy()
  })

  it('sorts the four visible columns', async () => {
    const listRuns = vi.fn<ApiClient['listRuns']>(
      async () =>
        ({
          data: [
            runSummary,
            {
              ...runSummary,
              runId: 'a-run',
              status: 'FAILED',
              startedAt: '2026-08-20T09:00:00Z',
              durationMs: 240_000,
            },
          ],
          pagination: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 },
        }) as unknown as RunHistoryPage,
    )
    render(<RunHistory client={{ listRuns }} page={1} />)

    await screen.findByRole('link', { name: 'Open run run-newest' })
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Run ID ascending' }))
    expect(
      screen.getAllByRole('link', { name: /^Open run/ }).map((link) => link.textContent),
    ).toEqual(['a-run', 'run-newest'])

    for (const column of ['Started', 'Duration', 'Status']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`Sort by ${column}`) }))
    }
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
