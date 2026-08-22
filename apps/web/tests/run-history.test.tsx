// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RunIdSchema, WorkflowIdSchema } from '@slopify/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RunsPage from '../app/runs/page'
import { formatRunHistoryTimestamp, RunHistory } from '../components/runs/run-history'
import { formatTimestamp } from '../components/runs/run-status'
import { createApiClient, type ApiClient, type RunHistoryPage } from '../lib/api-client'

const runSummary = {
  runId: RunIdSchema.parse('run-newest'),
  workflowId: WorkflowIdSchema.parse('delivery-workflow'),
  status: 'SUCCEEDED',
  createdAt: '2026-08-20T11:00:00Z',
  startedAt: '2026-08-20T11:00:01Z',
  completedAt: '2026-08-20T11:02:01Z',
  durationMs: 120_000,
} as const

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('run history API client', () => {
  it('loads a validated page without changing the server order', async () => {
    const page = {
      data: [runSummary, { ...runSummary, runId: 'run-older' }],
      pagination: { page: 2, pageSize: 20, totalItems: 22, totalPages: 2 },
    }
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(page))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(
      client.listRuns({
        page: 2,
        pageSize: 20,
        runId: 'api-1',
        statuses: ['FAILED', 'CANCELLED'],
        durationMinMs: 1_000,
      }),
    ).resolves.toEqual(page)
    expect(fetchImplementation).toHaveBeenCalledWith(
      '/api/runs?page=2&pageSize=20&runId=api-1&status=FAILED&status=CANCELLED&durationMinMs=1000',
      expect.any(Object),
    )
  })
})

describe('run history page', () => {
  it('uses relative started times only for runs from the viewer current day', () => {
    const now = new Date('2026-08-22T18:30:00Z')

    expect(formatRunHistoryTimestamp('2026-08-22T18:29:42Z', now)).toBe('18 seconds ago')
    expect(formatRunHistoryTimestamp('2026-08-22T18:10:00Z', now)).toBe('20 minutes ago')
    expect(formatRunHistoryTimestamp('2026-08-22T16:30:00Z', now)).toBe('2 hours ago')
    expect(formatRunHistoryTimestamp('2026-08-21T12:00:00Z', now)).toBe(
      formatTimestamp('2026-08-21T12:00:00Z'),
    )
    expect(formatRunHistoryTimestamp(null, now)).toBe('Not recorded')
  })

  it('makes the exact started date and time accessible from the relative value', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-08-22T18:30:00Z'))
    const listRuns = vi.fn<ApiClient['listRuns']>(async () => ({
      data: [{ ...runSummary, startedAt: '2026-08-22T16:30:00Z' }],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    }))

    render(<RunHistory client={{ listRuns }} page={1} />)

    const relativeTime = await screen.findByText('2 hours ago')
    expect(relativeTime.tagName).toBe('TIME')
    expect(relativeTime.getAttribute('datetime')).toBe('2026-08-22T16:30:00Z')
    expect(relativeTime.getAttribute('tabindex')).toBe('0')
    expect(relativeTime.getAttribute('aria-label')).toBe(
      `Started ${formatTimestamp('2026-08-22T16:30:00Z')}`,
    )
  })

  it('shows a table skeleton while run history is loading', async () => {
    let resolve: ((value: RunHistoryPage) => void) | undefined
    const listRuns = vi.fn(
      () =>
        new Promise<RunHistoryPage>((next) => {
          resolve = next
        }),
    )
    render(<RunHistory client={{ listRuns }} page={1} />)

    const loading = screen.getByRole('status', { name: 'Loading run history' })
    expect(within(loading).getByRole('table', { name: 'Loading workflow runs' })).toBeTruthy()
    expect(within(loading).getAllByTestId('run-row-skeleton')).toHaveLength(8)

    await act(async () =>
      resolve?.({
        data: [],
        pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading run history' })).toBeNull(),
    )
  })

  it('normalizes URL pagination before crossing the client boundary', async () => {
    const valid = await RunsPage({
      searchParams: Promise.resolve({
        page: '3',
        status: ['FAILED', 'invalid'],
        startedFrom: '2026-08-20',
        durationMinSeconds: '1.5',
      }),
    })
    const invalid = await RunsPage({ searchParams: Promise.resolve({ page: ['3', '4'] }) })

    expect(valid).toMatchObject({
      props: {
        page: 3,
        initialFilters: {
          statuses: ['FAILED'],
          startedFrom: '2026-08-20',
          durationMinSeconds: '1.5',
        },
      },
    })
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
    const surface = screen.getByTestId('run-history-surface')
    const toolbar = screen.getByRole('toolbar', { name: 'Run history controls' })

    expect(surface.className).not.toContain('rounded')
    expect(surface.className).not.toContain('shadow')
    expect(surface.className).not.toContain('border')
    expect(screen.queryByText('All runs')).toBeNull()
    expect(toolbar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
    expect(screen.getByRole('button', { name: 'Filters' }).className).toContain('border-0')
    expect(screen.getByText('Previous').className).toContain('border-0')
    expect(screen.getByText('Next').className).toContain('border-0')
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

    await screen.findByRole('link', { name: 'Open run newest' })
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Run ID ascending' }))
    expect(
      screen.getAllByRole('link', { name: /^Open run/ }).map((link) => link.textContent),
    ).toEqual(['a-run', 'newest'])

    for (const column of ['Started', 'Duration', 'Status']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`Sort by ${column}`) }))
    }
  })

  it('hides the run prefix throughout the UI while preserving the full link target', async () => {
    const listRuns = vi.fn<ApiClient['listRuns']>(
      async () =>
        ({
          data: [runSummary],
          pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        }) as unknown as RunHistoryPage,
    )
    render(<RunHistory client={{ listRuns }} page={1} />)

    const link = await screen.findByRole('link', { name: 'Open run newest' })
    expect(link.textContent).toBe('newest')
    expect(link.getAttribute('href')).toBe('/runs/run-newest')
  })

  it('applies typed filters, reports counts, and removes them from toolbar chips', async () => {
    const listRuns = vi.fn<ApiClient['listRuns']>(
      async () =>
        ({
          data: [runSummary],
          pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        }) as unknown as RunHistoryPage,
    )
    render(<RunHistory client={{ listRuns }} page={1} />)

    await screen.findByRole('link', { name: 'Open run newest' })
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))

    const attributeSearch = await screen.findByRole('textbox', {
      name: 'Search',
    })
    expect(attributeSearch.closest('[data-slot="popover-content"]')?.className).toContain(
      'w-[min(18rem,calc(100vw-2rem))]',
    )
    expect(attributeSearch.getAttribute('placeholder')).toBe('Search…')
    expect(screen.queryByText('User attributes')).toBeNull()
    fireEvent.change(attributeSearch, { target: { value: 'status' } })
    expect(screen.queryByRole('button', { name: 'Run ID' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    for (const [label, textClassName, hoverClassName, selectedClassName] of [
      ['Pending', 'text-muted-foreground', 'hover:bg-muted/70', 'aria-checked:bg-muted'],
      ['Running', 'text-status-info', 'hover:bg-status-info/10', 'aria-checked:bg-status-info/15'],
      [
        'Succeeded',
        'text-status-success',
        'hover:bg-status-success/10',
        'aria-checked:bg-status-success/15',
      ],
      ['Failed', 'text-destructive', 'hover:bg-destructive/10', 'aria-checked:bg-destructive/15'],
      [
        'Cancelled',
        'text-status-warning',
        'hover:bg-status-warning/10',
        'aria-checked:bg-status-warning/15',
      ],
      [
        'Interrupted',
        'text-destructive',
        'hover:bg-destructive/10',
        'aria-checked:bg-destructive/15',
      ],
    ] as const) {
      const option = screen.getByRole('checkbox', { name: label })
      expect(option.className).toContain(textClassName)
      expect(option.className).toContain(hoverClassName)
      expect(option.className).toContain(selectedClassName)
      expect(option.querySelector('[data-slot="badge"]')).toBeNull()
    }
    fireEvent.click(screen.getByRole('checkbox', { name: 'Failed' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cancelled' }))
    expect(screen.getByRole('checkbox', { name: 'Failed' }).getAttribute('aria-checked')).toBe(
      'true',
    )

    await waitFor(() =>
      expect(listRuns).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        statuses: ['FAILED', 'CANCELLED'],
      }),
    )
    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeTruthy()
    const statusChip = screen
      .getByText('Status: Failed, Cancelled')
      .closest('[data-slot="run-filter-chip"]')
    const removeStatus = screen.getByRole('button', { name: 'Remove Status filter' })
    const removeSlot = removeStatus.closest('[data-slot="run-filter-chip-remove-slot"]')
    expect(statusChip?.className).toContain('group/filter-chip')
    expect(statusChip?.className).toContain('transition-[padding-right]')
    expect(statusChip?.className).toContain('hover:pr-1.5')
    expect(statusChip?.className).toContain('focus-within:pr-1.5')
    expect(removeSlot?.className).toContain('t-resize')
    expect(removeSlot?.className).toContain('w-0')
    expect(removeSlot?.className).toContain('group-hover/filter-chip:w-7')
    expect(removeSlot?.className).toContain('group-focus-within/filter-chip:w-7')
    expect(removeStatus.className).toContain('transition-opacity')
    expect(removeStatus.className).toContain('hover:bg-foreground/10')

    fireEvent.click(screen.getByRole('button', { name: 'Back to filter attributes' }))
    expect(screen.getByRole('button', { name: 'Status, 2 selected' }).textContent).toContain('2')
    fireEvent.click(removeStatus)

    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 }))
    expect(screen.queryByRole('button', { name: 'Remove Status filter' })).toBeNull()
  })

  it('uses text, date-range, and numeric-range editors for their attributes', async () => {
    const listRuns = vi.fn<ApiClient['listRuns']>(
      async () =>
        ({
          data: [runSummary],
          pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        }) as unknown as RunHistoryPage,
    )
    render(<RunHistory client={{ listRuns }} page={1} />)

    await screen.findByRole('link', { name: 'Open run newest' })
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Run ID' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Run ID contains' }), {
      target: { value: 'run-new' },
    })
    await waitFor(() =>
      expect(listRuns).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, runId: 'run-new' }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back to filter attributes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Started' }))
    const startedFrom = screen.getByRole('button', { name: 'Started from' })
    const startedThrough = screen.getByRole('button', { name: 'Started through' })
    expect(startedFrom.textContent).toContain('Pick a date')
    expect(startedThrough.textContent).toContain('Pick a date')
    expect(startedFrom.parentElement?.className).toContain('gap-2')
    expect(startedThrough.parentElement?.className).toContain('gap-2')
    expect(screen.queryByLabelText('Started from', { selector: 'input[type="date"]' })).toBeNull()

    fireEvent.click(startedFrom)
    const calendar = await screen.findByTestId('started-from-calendar')
    fireEvent.click(within(calendar).getByRole('button', { name: /August 20/ }))
    expect(startedFrom.textContent).toContain('Aug 20, 2026')

    fireEvent.click(screen.getByRole('button', { name: 'Back to filter attributes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Duration' }))
    const minimumDuration = screen.getByRole('spinbutton', {
      name: 'Minimum duration in seconds',
    })
    const maximumDuration = screen.getByRole('spinbutton', {
      name: 'Maximum duration in seconds',
    })
    expect(minimumDuration.closest('label')?.className).toContain('gap-2')
    expect(maximumDuration.closest('label')?.className).toContain('gap-2')

    fireEvent.change(minimumDuration, {
      target: { value: '1.5' },
    })
    fireEvent.change(maximumDuration, {
      target: { value: '3' },
    })

    await waitFor(() =>
      expect(listRuns).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        runId: 'run-new',
        startedFrom: '2026-08-20T00:00:00.000Z',
        durationMinMs: 1_500,
        durationMaxMs: 3_000,
      }),
    )
  })

  it('marks existing rows as stale while a filtered server page is loading', async () => {
    const page = {
      data: [runSummary],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    } as unknown as RunHistoryPage
    let resolveRefresh: ((value: RunHistoryPage) => void) | undefined
    let requestCount = 0
    const listRuns = vi.fn<ApiClient['listRuns']>(async (): Promise<RunHistoryPage> =>
      ++requestCount === 1
        ? page
        : await new Promise<RunHistoryPage>((resolve) => {
            resolveRefresh = resolve
          }),
    )
    render(<RunHistory client={{ listRuns }} page={1} />)

    await screen.findByRole('link', { name: 'Open run newest' })
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Status' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Failed' }))

    const runs = screen.getByRole('region', { name: 'Runs' })
    await waitFor(() => expect(runs.getAttribute('aria-busy')).toBe('true'))
    expect(screen.getByText('Updating…')).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Workflow runs' }).className).toContain('opacity-60')

    resolveRefresh?.(page)
    await waitFor(() => expect(runs.getAttribute('aria-busy')).toBe('false'))
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

  it('presents the filtered empty-state recovery as a text button', async () => {
    const listRuns = vi.fn<ApiClient['listRuns']>(async () => ({
      data: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    }))

    render(
      <RunHistory
        client={{ listRuns }}
        initialFilters={{
          runId: '',
          statuses: ['CANCELLED'],
          startedFrom: '',
          startedTo: '',
          durationMinSeconds: '',
          durationMaxSeconds: '',
        }}
        page={1}
      />,
    )

    const clearFilters = await screen.findByRole('button', { name: 'Clear filters' })
    expect(clearFilters.className).toContain('text-primary')
    expect(clearFilters.className).not.toContain('border-border')

    fireEvent.click(clearFilters)
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 }))
  })
})
