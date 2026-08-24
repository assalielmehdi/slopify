import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentExecutionEventSchema, type AgentExecutor } from '@slopify/agent-runtimes'
import { GitShaSchema, ProjectIdSchema } from '@slopify/contracts'
import {
  createAgentNodeRunner,
  createEventStore,
  createExecutionWorker,
  createNativeGitRunWorkspaceProvisioner,
  createOrchestratedRunService,
  createProcessRunner,
  createRunEventFeed,
  createRunRepository,
  createRunService,
  createSqliteCoordinatorStateStore,
  createSqliteExecutionMessageQueue,
  createWorkflowCoordinator,
  createWorkflowRepository,
  openDatabase,
  type ProcessRunner,
} from '@slopify/execution-runtime'

import { createApiApp } from '../src/app.js'
import { createExecutionPump } from '../src/execution-pump.js'
import {
  createTestAgentWorkflow,
  createTestHarnessCatalog,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('orchestrated run HTTP flow', () => {
  it('admits, executes, persists, and returns a completed leaf-agent run', async () => {
    const directory = join(tmpdir(), `slopify-api-e2e-${crypto.randomUUID()}`)
    const sourceRepository = join(directory, 'source', 'api')
    const workspacesRoot = join(directory, 'workspaces')
    mkdirSync(sourceRepository, { recursive: true })
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', sourceRepository])
    execFileSync('git', ['-C', sourceRepository, 'config', 'user.email', 'test@slopify.local'])
    execFileSync('git', ['-C', sourceRepository, 'config', 'user.name', 'Slopify Test'])
    writeFileSync(join(sourceRepository, 'README.md'), 'source repository\n')
    execFileSync('git', ['-C', sourceRepository, 'add', 'README.md'])
    execFileSync('git', ['-C', sourceRepository, 'commit', '--quiet', '-m', 'initial'])
    const baseSha = execFileSync('git', ['-C', sourceRepository, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim()
    const database = openDatabase({ path: join(directory, 'state.sqlite') })
    cleanups.push(() => {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    })
    const workflows = createWorkflowRepository(database)
    const workflow = createTestAgentWorkflow({
      createdAt: '2026-08-20T12:00:00.000Z',
      projectIds: ['project-api'],
      primaryProjectId: 'project-api',
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
    const harnesses = createTestHarnessCatalog()
    const agent: AgentExecutor = {
      execute(input) {
        return (async function* () {
          const primary = input.workspace.projects.find(
            ({ projectId }) => projectId === input.workspace.primaryProjectId,
          )
          if (primary === undefined) throw new Error('Expected a primary run workspace')
          if (!existsSync(join(primary.path, 'README.md'))) throw new Error('Clone was not ready')
          writeFileSync(join(primary.path, 'agent-result.txt'), 'written in the run clone\n')
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
    const nativeProcessRunner = createProcessRunner({ maxOutputBytes: 16_384 })
    const processRunner: ProcessRunner = {
      run(input) {
        const arguments_ = input.arguments.includes('clone')
          ? input.arguments.map((argument) =>
              argument === 'https://github.com/operator/api.git' ? sourceRepository : argument,
            )
          : input.arguments
        return nativeProcessRunner.run({ ...input, arguments: arguments_ })
      },
    }
    const workspaces = createNativeGitRunWorkspaceProvisioner({
      runs,
      workspacesRoot,
      processRunner,
      credentialHelper: '!true',
      now: () => '2026-08-20T12:00:02.000Z',
    })
    const runner = createAgentNodeRunner({
      harnesses,
      resolveHarness: (harnessId) => (harnessId === 'pi' ? agent : undefined),
      workspaces,
      runs,
    })
    const worker = createExecutionWorker({
      workerId: 'worker-e2e',
      queue,
      runner,
      now: () => '2026-08-20T12:00:02.000Z',
    })
    const pump = createExecutionPump({
      coordinator,
      worker,
      pollIntervalMs: 1_000,
      recoverExpired: () => undefined,
      async cleanupTerminalRuns() {
        for (const runId of runs.listTerminalRunIdsNeedingWorkspaceCleanup()) {
          await workspaces.cleanup(runId)
        }
      },
    })
    const baseRuns = createRunService({
      events,
      runs,
      workflows,
      harnesses,
      resolveProject: async (projectId) => ({
        projectId: ProjectIdSchema.parse(projectId),
        name: 'API',
        provider: 'GITHUB',
        remoteId: '123',
        fullName: 'operator/api',
        cloneUrl: 'https://github.com/operator/api.git',
        defaultBranch: 'main',
        baseSha: GitShaSchema.parse(baseSha),
      }),
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
          nodeId: 'agent',
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
    const workspacePath = join(realpathSync(workspacesRoot), 'run-e2e', 'project-api')
    expect(existsSync(workspacePath)).toBe(false)
    expect(existsSync(join(sourceRepository, 'agent-result.txt'))).toBe(false)
    expect(runs.listRunProjectWorkspaces('run-e2e')).toMatchObject([
      {
        projectId: 'project-api',
        status: 'CLEANED',
        workspacePath,
        branchName: 'slopify/run-e2e',
      },
    ])
    await pump.stop()
  })
})
