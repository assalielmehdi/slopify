import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentTraceHeaderSchema } from '@slopify/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createFilesystemAgentTraceStore,
  createFilesystemRunIndex,
  createFilesystemRunReader,
  createLegacyCatalogConverter,
  createLegacyMigrationService,
  createLegacyRunConverter,
  createRunFilesystemAgentTraceStore,
  resolveSlopifyPaths,
} from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'
import {
  TEST_RUN_ID,
  TEST_RUN_REPOSITORY,
  TEST_TIMESTAMP,
  createPersistenceFixture,
  createRun,
  createTestAgentWorkflow,
} from '../persistence/test-fixture.js'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('legacy terminal run converter', () => {
  it('preserves run and node counts and exposes converted detail and trace content', async () => {
    const workflow = createTestAgentWorkflow({
      repositoryIds: [TEST_RUN_REPOSITORY.repositoryId],
      primaryRepositoryId: TEST_RUN_REPOSITORY.repositoryId,
    })
    const fixture = createPersistenceFixture(workflow)
    cleanups.push(fixture.cleanup)
    await fixture.repositories.add({
      repositoryId: TEST_RUN_REPOSITORY.repositoryId,
      name: TEST_RUN_REPOSITORY.name,
      provider: TEST_RUN_REPOSITORY.provider,
      remoteId: TEST_RUN_REPOSITORY.remoteId,
      fullName: TEST_RUN_REPOSITORY.fullName,
      cloneUrl: TEST_RUN_REPOSITORY.cloneUrl,
      webUrl: 'https://github.com/operator/api',
      defaultBranch: TEST_RUN_REPOSITORY.defaultBranch,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP,
    })
    createRun(fixture)
    const connection = getDatabaseHandle(fixture.database)
    connection
      .prepare(
        `UPDATE runs SET status = 'SUCCEEDED', started_at = ?, completed_at = ?
         WHERE run_id = ?`,
      )
      .run('2026-08-23T12:00:01.000Z', '2026-08-23T12:00:03.000Z', TEST_RUN_ID)
    connection
      .prepare(
        `INSERT INTO node_executions (
           node_execution_id, run_id, node_id, execution_index, attempt_id, status,
           output_json, outcome, started_at, completed_at, duration_ms
         ) VALUES (?, ?, ?, ?, ?, 'SUCCEEDED', json(?), ?, ?, ?, ?)`,
      )
      .run(
        'execution-01',
        TEST_RUN_ID,
        'agent',
        1,
        'attempt-01',
        JSON.stringify({ summary: 'Completed from SQLite.' }),
        'completed',
        '2026-08-23T12:00:01.000Z',
        '2026-08-23T12:00:03.000Z',
        2_000,
      )
    connection
      .prepare(
        `INSERT INTO run_repository_workspaces (
           run_id, repository_id, status, workspace_path, branch_name,
           prepared_at, cleaned_at, updated_at
         ) VALUES (?, ?, 'CLEANED', ?, ?, ?, ?, ?)`,
      )
      .run(
        TEST_RUN_ID,
        TEST_RUN_REPOSITORY.repositoryId,
        `/tmp/slopify-legacy/${TEST_RUN_ID}/${TEST_RUN_REPOSITORY.repositoryId}`,
        `slopify/${TEST_RUN_ID}`,
        '2026-08-23T12:00:01.000Z',
        '2026-08-23T12:00:03.000Z',
        '2026-08-23T12:00:03.000Z',
      )

    const root = join(tmpdir(), `slopify-run-migration-${crypto.randomUUID()}`)
    mkdirSync(root, { recursive: true })
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const legacyTracesRoot = join(root, 'legacy-traces')
    const legacyTraces = createFilesystemAgentTraceStore({ root: legacyTracesRoot })
    const header = AgentTraceHeaderSchema.parse({
      version: 1,
      runId: TEST_RUN_ID,
      nodeExecutionId: 'execution-01',
      attemptId: 'attempt-01',
      nodeId: 'agent',
      createdAt: '2026-08-23T12:00:01.000Z',
      configuration: {
        harnessId: 'pi',
        harnessVersion: '0.84.2',
        model: 'test/model',
        thinkingLevel: 'medium',
        renderedPrompt: 'Complete the test task.',
        workspaceRoot: `/tmp/slopify-legacy/${TEST_RUN_ID}`,
        primaryRepositoryId: TEST_RUN_REPOSITORY.repositoryId,
        repositories: [
          {
            repositoryId: TEST_RUN_REPOSITORY.repositoryId,
            name: TEST_RUN_REPOSITORY.name,
            worktreePath: `/tmp/slopify-legacy/${TEST_RUN_ID}/${TEST_RUN_REPOSITORY.repositoryId}`,
            baseSha: TEST_RUN_REPOSITORY.baseSha,
            sourceBranch: 'main',
          },
        ],
        timeoutSeconds: 600,
      },
    })
    await legacyTraces.start(header)
    await legacyTraces.append(header, {
      executionId: 'execution-01',
      runId: TEST_RUN_ID,
      nodeId: 'agent',
      timestamp: '2026-08-23T12:00:02.000Z',
      type: 'AGENT_REASONING',
      data: { content: 'This trace came from the legacy run.' },
    })
    await legacyTraces.append(header, {
      executionId: 'execution-01',
      runId: TEST_RUN_ID,
      nodeId: 'agent',
      timestamp: '2026-08-23T12:00:03.000Z',
      type: 'AGENT_RESULT',
      data: {
        result: { outcome: 'completed', summary: 'Done', data: {}, evidence: [] },
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        durationMs: 2_000,
      },
    })
    fixture.database.close()

    const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: join(root, 'home') } })
    const preparation = await createLegacyMigrationService({
      databasePath: fixture.path,
      paths,
      createMigrationId: () => 'sqlite-v4-runs',
      now: () => '2026-08-25T12:00:00.000Z',
    }).prepare()
    await createLegacyCatalogConverter({ preparation }).convert()

    const result = await createLegacyRunConverter({ preparation, legacyTracesRoot }).convert()

    expect(result).toEqual({ runs: 1, nodes: 1, traces: 1 })
    const exportPaths = resolveSlopifyPaths({
      environment: { SLOPIFY_HOME: preparation.exportDirectory },
    })
    const index = createFilesystemRunIndex({ paths: exportPaths })
    const detail = await createFilesystemRunReader({ index, paths: exportPaths }).get(TEST_RUN_ID)
    expect(detail).toMatchObject({
      status: 'READY',
      run: { status: 'SUCCEEDED' },
      workflowSnapshot: { workflow: { workflowId: workflow.workflowId } },
      variablesSnapshot: { values: {} },
      repositoriesSnapshot: {
        repositories: [{ repositoryId: TEST_RUN_REPOSITORY.repositoryId, isPrimary: true }],
      },
      workspaces: { workspaces: [{ status: 'CLEANED' }] },
      executions: [
        {
          nodeExecutionId: 'execution-01',
          status: 'SUCCEEDED',
          output: { summary: 'Completed from SQLite.' },
        },
      ],
    })
    await expect(
      createRunFilesystemAgentTraceStore({ paths: exportPaths }).read({
        workflowId: workflow.workflowId,
        executionIndex: 1,
        runId: TEST_RUN_ID,
        nodeExecutionId: 'execution-01',
        attemptId: 'attempt-01',
      }),
    ).resolves.toMatchObject({
      complete: true,
      events: [
        { type: 'AGENT_REASONING', data: { content: 'This trace came from the legacy run.' } },
        { type: 'AGENT_RESULT' },
      ],
    })
  })
})
