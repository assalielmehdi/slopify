import { describe, expect, it, vi } from 'vitest'

import {
  type FilesystemRunAdmissionService,
  type FilesystemRunIndex,
  type FilesystemRunReader,
  JournalCancellationServiceError,
  JournalCoordinatorError,
  type JournalCancellationService,
  type RunProjectionState,
} from '../src/index.js'
import { createApiApp } from '../src/app.js'

const filesystemProjection: RunProjectionState = {
  run: {
    schemaVersion: 1,
    runId: 'run-filesystem-cancel',
    workflowId: 'filesystem-review',
    status: 'CANCELLED',
    transitionCount: 0,
    lastEventSequence: 2,
    createdAt: '2026-08-25T10:00:00.000Z',
    startedAt: '2026-08-25T10:00:00.000Z',
    completedAt: '2026-08-25T10:00:01.000Z',
    failureCode: null,
  },
  workspaces: {
    schemaVersion: 1,
    runId: 'run-filesystem-cancel',
    lastEventSequence: 2,
    workspaces: [],
  },
  executions: [],
  routing: { traversed: [], joinArrivals: {} },
  processedEventIds: [],
  scheduleKeys: [],
}

const filesystemCancellationFixture = () => {
  const locator = {
    status: 'READY' as const,
    locator: { workflowId: 'filesystem-review', runId: 'run-filesystem-cancel' },
    run: { ...filesystemProjection.run, status: 'RUNNING' as const },
  }
  const index = {
    get: vi.fn(async () => locator),
    list: vi.fn(async () => ({
      data: [locator],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    })),
    listLatestFinished: vi.fn(async () => []),
    refresh: vi.fn(async () => undefined),
  } satisfies FilesystemRunIndex
  const cancellation = {
    cancel: vi.fn(async () => filesystemProjection),
  } satisfies JournalCancellationService
  const admissions = {
    stopAdmissions: vi.fn(),
    create: vi.fn(async () => locator.run),
  } satisfies FilesystemRunAdmissionService
  const reader = { get: vi.fn(async () => undefined) } satisfies FilesystemRunReader
  const app = createApiApp({
    filesystemRuns: { admissions, index, reader, cancellation },
  })
  return { app, cancellation, index }
}

describe('filesystem run cancellation API', () => {
  it('resolves the captured workflow locator before requesting cancellation', async () => {
    const fixture = filesystemCancellationFixture()

    const response = await fixture.app.request('/api/runs/run-filesystem-cancel/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Operator stopped the run' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      runId: 'run-filesystem-cancel',
      workflowId: 'filesystem-review',
      status: 'CANCELLED',
    })
    expect(fixture.cancellation.cancel).toHaveBeenCalledWith({
      workflowId: 'filesystem-review',
      runId: 'run-filesystem-cancel',
      reason: 'Operator stopped the run',
    })
  })

  it('distinguishes missing and corrupt run artifacts before cancellation', async () => {
    const fixture = filesystemCancellationFixture()
    fixture.index.get.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      status: 'CORRUPT',
      locator: { workflowId: 'filesystem-review', runId: 'run-filesystem-cancel' },
      diagnostic: { code: 'RESOURCE_MALFORMED', message: 'Run projection is malformed' },
    })

    const missing = await fixture.app.request('/api/runs/missing/cancel', { method: 'POST' })
    const corrupt = await fixture.app.request('/api/runs/run-filesystem-cancel/cancel', {
      method: 'POST',
    })

    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: { code: 'RUN_NOT_FOUND' } })
    expect(corrupt.status).toBe(409)
    expect(await corrupt.json()).toEqual({
      error: {
        code: 'RUN_CORRUPT',
        message: 'Run artifacts are corrupt',
        details: { code: 'RESOURCE_MALFORMED', message: 'Run projection is malformed' },
      },
    })
    expect(fixture.cancellation.cancel).not.toHaveBeenCalled()
  })

  it('maps journal cancellation failures to stable conflict errors', async () => {
    const fixture = filesystemCancellationFixture()
    fixture.cancellation.cancel
      .mockRejectedValueOnce(
        new JournalCoordinatorError('RUN_NOT_CANCELLABLE', 'Run is not cancellable'),
      )
      .mockRejectedValueOnce(
        new JournalCancellationServiceError(
          'PROCESS_TERMINATION_UNCONFIRMED',
          'Active execution could not confirm cancellation',
        ),
      )

    const terminal = await fixture.app.request('/api/runs/run-filesystem-cancel/cancel', {
      method: 'POST',
    })
    const unconfirmed = await fixture.app.request('/api/runs/run-filesystem-cancel/cancel', {
      method: 'POST',
    })

    expect(terminal.status).toBe(409)
    expect(await terminal.json()).toMatchObject({ error: { code: 'RUN_NOT_CANCELLABLE' } })
    expect(unconfirmed.status).toBe(409)
    expect(await unconfirmed.json()).toMatchObject({
      error: { code: 'PROCESS_TERMINATION_UNCONFIRMED' },
    })
  })
})
