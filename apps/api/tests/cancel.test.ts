import { afterEach, describe, expect, it, vi } from 'vitest'

import { RunIdSchema } from '@slopify/contracts'
import {
  CancellationServiceError,
  createRunService,
  type CancellationService,
  type FilesystemRunAdmissionService,
  type FilesystemRunIndex,
  type FilesystemRunReader,
  JournalCancellationServiceError,
  JournalCoordinatorError,
  type JournalCancellationService,
  type RunProjectionState,
} from '@slopify/execution-runtime'
import {
  TEST_WORKFLOW_ID,
  createTestHarnessCatalog,
  createTestAgentWorkflow,
  createPersistenceFixture,
  resolveTestRepository,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createFixture = () => {
  const fixture = createPersistenceFixture(
    createTestAgentWorkflow({
      createdAt: '2026-08-18T23:30:00Z',
      repositoryIds: ['repository-api'],
      primaryRepositoryId: 'repository-api',
    }),
  )
  fixtures.push(fixture)
  const runs = createRunService({
    events: fixture.events,
    runs: fixture.runs,
    workflows: fixture.workflows,
    harnesses: createTestHarnessCatalog(),
    resolveRepository: resolveTestRepository,
    now: () => '2026-08-18T23:30:00Z',
    createRunId: () => 'run-api-cancel-1',
  })
  const cancel = vi.fn(
    async (
      input: Parameters<CancellationService['cancel']>[0],
    ): Promise<Awaited<ReturnType<CancellationService['cancel']>>> => {
      const run = fixture.runs.get(RunIdSchema.parse(input.runId))
      if (run === undefined)
        throw new CancellationServiceError('RUN_NOT_FOUND', 'Run was not found')
      throw new CancellationServiceError('RUN_NOT_CANCELLABLE', 'Run is not cancellable')
    },
  )
  const cancellation: CancellationService = {
    cancel,
    cancelActive: vi.fn(async () => undefined),
  }
  const app = createApiApp({ database: fixture.database, runs, cancellation })

  return { app, cancel, fixture }
}

const createBody = {
  workflowId: TEST_WORKFLOW_ID,
}

const createRun = async (fixture: ReturnType<typeof createFixture>): Promise<void> => {
  const response = await fixture.app.request('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(createBody),
  })
  expect(response.status).toBe(201)
}

describe('run cancellation API', () => {
  it('returns the run produced by the cancellation service', async () => {
    const fixture = createFixture()
    await createRun(fixture)
    const run = fixture.fixture.runs.get(RunIdSchema.parse('run-api-cancel-1'))
    if (run === undefined) throw new Error('Expected the created run')
    fixture.cancel.mockResolvedValueOnce({
      ...run,
      status: 'CANCELLED',
      completedAt: '2026-08-18T23:30:05Z',
      durationMs: 5_000,
    })

    const response = await fixture.app.request('/api/runs/run-api-cancel-1/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Operator stopped the run' }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      runId: 'run-api-cancel-1',
      status: 'CANCELLED',
    })
    expect(fixture.cancel).toHaveBeenCalledWith({
      runId: 'run-api-cancel-1',
      reason: 'Operator stopped the run',
    })
  })

  it('returns stable errors for unknown, non-cancellable, and malformed requests', async () => {
    const fixture = createFixture()
    await createRun(fixture)

    const unknown = await fixture.app.request('/api/runs/unknown/cancel', { method: 'POST' })
    const pending = await fixture.app.request('/api/runs/run-api-cancel-1/cancel', {
      method: 'POST',
    })
    const malformed = await fixture.app.request('/api/runs/run-api-cancel-1/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '' }),
    })

    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({
      error: { code: 'RUN_NOT_FOUND', message: 'Run was not found' },
    })
    expect(pending.status).toBe(409)
    expect(await pending.json()).toEqual({
      error: {
        code: 'RUN_NOT_CANCELLABLE',
        message: 'Run is not cancellable',
      },
    })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })
})

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
