import { afterEach, describe, expect, it, vi } from 'vitest'

import { NodeIdSchema, RunIdSchema } from '@loop/contracts'
import {
  createCancellationService,
  createRunService,
  type ActiveRunExecution,
} from '@loop/execution-runtime'
import { createPredefinedV1Workflow } from '@loop/workflow-model'
import {
  TEST_WORKFLOW_ID,
  createPersistenceFixture,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createFixture = () => {
  const fixture = createPersistenceFixture(
    createPredefinedV1Workflow({
      createdAt: '2026-08-18T23:30:00Z',
      agentDefaults: {
        provider: 'test-provider',
        model: 'test-model',
        thinkingLevel: 'medium',
      },
    }),
  )
  fixtures.push(fixture)
  const runs = createRunService({
    events: fixture.events,
    runs: fixture.runs,
    workflows: fixture.workflows,
    now: () => '2026-08-18T23:30:00Z',
    createRunId: () => 'run-api-cancel-1',
  })
  let activeExecution: ActiveRunExecution | undefined
  const cancellation = createCancellationService({
    runs: fixture.runs,
    activeExecution: () => activeExecution,
    now: () => '2026-08-18T23:30:05Z',
  })
  const app = createApiApp({ database: fixture.database, runs, cancellation })

  return {
    app,
    fixture,
    setActiveExecution(cancel: ActiveRunExecution['cancel']) {
      activeExecution = {
        runId: RunIdSchema.parse('run-api-cancel-1'),
        nodeExecutionId: 'node-execution-api-cancel-1',
        nodeId: NodeIdSchema.parse('identify-agent'),
        cancel,
      }
    },
  }
}

const createBody = {
  workflowId: TEST_WORKFLOW_ID,
}

const startRun = async (fixture: ReturnType<typeof createFixture>): Promise<void> => {
  await fixture.app.request('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(createBody),
  })
  const runId = RunIdSchema.parse('run-api-cancel-1')
  fixture.fixture.runs.changeStatus({
    runId,
    expectedStatus: 'PENDING',
    status: 'RUNNING',
    timestamp: '2026-08-18T23:30:01Z',
  })
  fixture.fixture.runs.startNode({
    runId,
    nodeExecutionId: 'node-execution-api-cancel-1',
    nodeId: 'identify-agent',
    inputReferences: [],
    timestamp: '2026-08-18T23:30:02Z',
  })
}

describe('run cancellation API', () => {
  it('returns the server-confirmed cancelled run and persists its evidence', async () => {
    const fixture = createFixture()
    await startRun(fixture)
    const cancel = vi.fn(async () => ({ status: 'cancelled' as const }))
    fixture.setActiveExecution(cancel)

    const response = await fixture.app.request('/api/runs/run-api-cancel-1/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Operator stopped the run' }),
    })
    const detail = await fixture.app.request('/api/runs/run-api-cancel-1')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      runId: 'run-api-cancel-1',
      status: 'CANCELLED',
    })
    expect(cancel).toHaveBeenCalledWith({ reason: 'Operator stopped the run' })
    expect(await detail.json()).toMatchObject({
      run: { status: 'CANCELLED' },
      nodeExecutions: [{ status: 'CANCELLED', errorCode: 'EXECUTOR_CANCELLED' }],
      events: [
        { type: 'RUN_STARTED' },
        { type: 'RUN_STATUS_CHANGED' },
        { type: 'NODE_STARTED' },
        { type: 'RUN_CANCEL_REQUESTED' },
        { type: 'NODE_FAILED' },
        { type: 'RUN_STATUS_CHANGED' },
        { type: 'RUN_COMPLETED' },
      ],
    })
  })

  it('returns stable errors for unknown, non-cancellable, and malformed requests', async () => {
    const fixture = createFixture()
    await fixture.app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createBody),
    })

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
        message: 'Run is not the active cancellable execution',
      },
    })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })
})
