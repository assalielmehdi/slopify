import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { AgentExecutionEventSchema, type AgentExecutor } from '@loop/agent-runtimes'
import {
  createAgentJobRunner,
  createAgentResultSchemaRegistry,
  createEventStore,
  createExecutionWorker,
  createJobRunnerRegistry,
  createOrchestratedRunService,
  createRunEventFeed,
  createRunRepository,
  createRunService,
  createSqliteCoordinatorStateStore,
  createSqliteExecutionMessageQueue,
  createWorkflowCoordinator,
  createWorkflowRepository,
  openDatabase,
} from '@loop/execution-runtime'
import { createPredefinedV1Workflow } from '@loop/workflow-model'

import { createApiApp } from '../src/app.js'
import { createExecutionPump } from '../src/execution-pump.js'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('orchestrated run HTTP flow', () => {
  it('admits, executes, persists, and returns a completed leaf-agent run', async () => {
    const directory = join(tmpdir(), `slopify-api-e2e-${crypto.randomUUID()}`)
    const database = openDatabase({ path: join(directory, 'state.sqlite') })
    cleanups.push(() => {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    })
    const workflows = createWorkflowRepository(database)
    const workflow = createPredefinedV1Workflow({
      createdAt: '2026-08-20T12:00:00.000Z',
      agentDefaults: {
        provider: 'test-provider',
        model: 'test-model',
        thinkingLevel: 'medium',
      },
    })
    workflows.save(workflow)
    const runs = createRunRepository(database)
    const events = createEventStore(database)
    const queue = createSqliteExecutionMessageQueue(database)
    const coordinator = createWorkflowCoordinator({
      coordinatorId: 'coordinator-e2e',
      queue,
      state: createSqliteCoordinatorStateStore(database),
      now: () => '2026-08-20T12:00:02.000Z',
    })
    const agent: AgentExecutor = {
      execute(input) {
        return (async function* () {
          yield AgentExecutionEventSchema.parse({
            executionId: input.executionId,
            runId: input.runId,
            nodeId: input.nodeId,
            timestamp: '2026-08-20T12:00:02.000Z',
            type: 'AGENT_RESULT',
            data: {
              result: {
                outcome: 'completed',
                summary: 'Agent identified itself',
                data: { identity: 'Slopify test agent' },
                artifacts: [],
                evidence: [],
              },
              usage: {
                inputTokens: 10,
                outputTokens: 20,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
              durationMs: 1_000,
            },
          })
        })()
      },
      cancel: vi.fn(async () => ({ status: 'cancelled' })),
    }
    const runner = createAgentJobRunner({
      agent,
      runs,
      resultSchemas: createAgentResultSchemaRegistry({ 'json:any-v1': z.json() }),
      resolveInference: (connectionId) =>
        connectionId === 'test-provider-default' ? { provider: 'test-provider' } : undefined,
    })
    const worker = createExecutionWorker({
      workerId: 'worker-e2e',
      queue,
      runners: createJobRunnerRegistry({ agent: runner }),
      now: () => '2026-08-20T12:00:02.000Z',
    })
    const pump = createExecutionPump({ coordinator, worker, pollIntervalMs: 1_000 })
    const baseRuns = createRunService({
      events,
      runs,
      workflows,
      now: () => '2026-08-20T12:00:00.000Z',
      createRunId: () => 'run-e2e',
    })
    const runService = createOrchestratedRunService({ runs: baseRuns, coordinator })
    const app = createApiApp({
      database,
      runs: runService,
      eventFeed: createRunEventFeed({ events, runs }),
    })

    const createResponse = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflowId: workflow.workflowId }),
    })
    expect(createResponse.status).toBe(201)
    expect(await createResponse.json()).toMatchObject({ runId: 'run-e2e', status: 'RUNNING' })

    await pump.wake()

    const detailResponse = await app.request('/api/runs/run-e2e')
    expect(detailResponse.status).toBe(200)
    const detail = await detailResponse.json()
    expect(detail).toMatchObject({
      run: { status: 'SUCCEEDED', transitionCount: 0 },
      nodeExecutions: [
        {
          nodeId: 'identify-agent',
          status: 'SUCCEEDED',
          outcome: 'completed',
          attemptId: expect.stringMatching(/^attempt-/u),
          output: {
            summary: 'Agent identified itself',
            data: { identity: 'Slopify test agent' },
          },
        },
      ],
    })
    expect(detail.events.map(({ type }: { type: string }) => type)).toEqual(
      expect.arrayContaining([
        'RUN_STATUS_CHANGED',
        'NODE_STARTED',
        'NODE_COMPLETED',
        'RUN_COMPLETED',
      ]),
    )
    await pump.stop()
  })
})
