import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createEventStore,
  createExecutionWorker,
  createExecutorRegistry,
  createJobRunnerRegistry,
  createNodeExecutorJobRunner,
  createOrchestratedRunService,
  createProfileRepository,
  createRunEventFeed,
  createRunRepository,
  createRunService,
  createSqliteCoordinatorStateStore,
  createSqliteExecutionMessageQueue,
  createWorkflowCoordinator,
  createWorkflowRepository,
  openDatabase,
  type ReadinessService,
} from '@loop/execution-runtime'
import { WorkflowRevisionSchema } from '@loop/workflow-model'

import { createApiApp } from '../src/app.js'
import { createExecutionPump } from '../src/execution-pump.js'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('orchestrated run HTTP flow', () => {
  it('admits, executes, routes, persists, and returns a completed run', async () => {
    const directory = join(tmpdir(), `slopify-api-e2e-${crypto.randomUUID()}`)
    const database = openDatabase({ path: join(directory, 'state.sqlite') })
    cleanups.push(() => {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    })
    const workflows = createWorkflowRepository(database)
    const workflow = WorkflowRevisionSchema.parse({
      workflowId: 'workflow-e2e',
      revisionId: 'revision-e2e',
      name: 'HTTP execution',
      description: 'One deterministic command proves the complete runtime path.',
      startNodeId: 'execute',
      nodes: [
        {
          type: 'command',
          id: 'execute',
          name: 'Execute',
          description: 'Execute deterministic work.',
          commandId: 'e2e-command',
          outcomes: ['done'],
          timeoutSeconds: 30,
        },
        { type: 'terminal', id: 'complete', name: 'Complete', terminalStatus: 'SUCCEEDED' },
      ],
      edges: [
        { sourceNodeId: 'execute', outcome: 'done', targetNodeId: 'complete', label: 'Done' },
      ],
      maxTransitions: 2,
      createdAt: '2026-08-20T12:00:00.000Z',
    })
    workflows.addRevision(workflow)
    const profiles = createProfileRepository(database)
    profiles.save(
      {
        profileId: 'profile-e2e',
        displayName: 'E2E profile',
        clickupWorkspaceId: 'workspace-e2e',
        clickupListId: 'list-e2e',
        clickupInReviewStatusId: 'review-e2e',
        repositories: [
          {
            repositoryId: 'repo-e2e',
            displayName: 'Repository',
            purpose: 'Test',
            repositoryPath: directory,
            gitlabProject: 'group/repo',
            remote: 'origin',
            targetBranch: 'main',
            worktreeParent: directory,
            branchTemplate: 'run/{run}',
            executableChecks: [],
            verificationCommands: [],
            mergeRequestLabels: [],
          },
        ],
      },
      '2026-08-20T12:00:00.000Z',
    )
    const runs = createRunRepository(database)
    const events = createEventStore(database)
    const queue = createSqliteExecutionMessageQueue(database)
    const coordinator = createWorkflowCoordinator({
      coordinatorId: 'coordinator-e2e',
      queue,
      state: createSqliteCoordinatorStateStore(database),
      now: () => '2026-08-20T12:00:02.000Z',
    })
    const runner = createNodeExecutorJobRunner({
      runs,
      executors: createExecutorRegistry({
        commands: {
          'e2e-command': {
            execute: async () => ({
              status: 'succeeded',
              outcome: 'done',
              output: { result: 'completed' },
              artifactIds: [],
            }),
          },
        },
      }),
    })
    const worker = createExecutionWorker({
      workerId: 'worker-e2e',
      queue,
      runners: createJobRunnerRegistry({ command: runner }),
      now: () => '2026-08-20T12:00:02.000Z',
    })
    const pump = createExecutionPump({ coordinator, worker, pollIntervalMs: 1_000 })
    const baseRuns = createRunService({
      events,
      profiles,
      readiness: {
        check: async () => ({ ready: true, checks: [] }),
      } as unknown as ReadinessService,
      runs,
      tasks: { resolve: async () => ({ taskId: 'TASK-E2E', title: 'Execute E2E' }) },
      workflows,
      now: () => '2026-08-20T12:00:00.000Z',
      createRunId: () => 'run-e2e',
      createProfileSnapshotId: () => 'profile-snapshot-e2e',
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
      body: JSON.stringify({
        taskReference: 'TASK-E2E',
        workflowId: workflow.workflowId,
        revisionId: workflow.revisionId,
        profileId: 'profile-e2e',
      }),
    })
    expect(createResponse.status).toBe(201)
    expect(await createResponse.json()).toMatchObject({ runId: 'run-e2e', status: 'RUNNING' })

    await pump.wake()

    const detailResponse = await app.request('/api/runs/run-e2e')
    expect(detailResponse.status).toBe(200)
    const detail = await detailResponse.json()
    expect(detail).toMatchObject({
      run: { status: 'SUCCEEDED', transitionCount: 1 },
      nodeExecutions: [
        {
          nodeId: 'execute',
          status: 'SUCCEEDED',
          outcome: 'done',
          attemptId: expect.stringMatching(/^attempt-/u),
          output: { result: 'completed' },
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
