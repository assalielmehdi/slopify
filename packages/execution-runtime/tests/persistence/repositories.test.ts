import { afterEach, describe, expect, it } from 'vitest'

import { PersistenceError } from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'
import {
  TEST_RUN_ID,
  createPersistenceFixture,
  createRun,
  createTestAgentWorkflow,
} from './test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

describe('current repositories', () => {
  it('inserts multiple workflows without overwriting an existing identity', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const second = createTestAgentWorkflow({
      workflowId: 'release-workflow',
      createdAt: '2026-08-23T12:01:00.000Z',
    })

    fixture.workflows.insert(second)

    expect(fixture.workflows.get(fixture.workflow.workflowId)).toEqual(fixture.workflow)
    expect(fixture.workflows.get(second.workflowId)).toEqual(second)
    expect(fixture.workflows.list()).toEqual([second, fixture.workflow])
    expect(() => fixture.workflows.insert(second)).toThrowError(
      expect.objectContaining({ code: 'PERSISTENCE_CONFLICT' }),
    )
    expect(fixture.workflows.get(second.workflowId)).toEqual(second)
  })

  it('saves and replaces the current workflow', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const updated = {
      ...fixture.workflow,
      name: 'Updated workflow',
      updatedAt: '2026-08-23T12:01:00.000Z',
    }

    fixture.workflows.save(updated)

    expect(fixture.workflows.get(fixture.workflow.workflowId)).toEqual(updated)
    expect(fixture.workflows.list()).toEqual([updated])
  })

  it('deletes a current workflow without removing immutable run history', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const admittedRun = createRun(fixture)

    const receipt = {
      deletionId: 'deletion-workflow-01',
      subject: { type: 'WORKFLOW' as const, id: fixture.workflow.workflowId },
      deletedAt: '2026-08-25T10:00:00.000Z',
      undoExpiresAt: '2026-08-25T10:00:10.000Z',
    }

    expect(fixture.workflows.stageDeletion(receipt)).toBe(true)

    expect(fixture.workflows.get(fixture.workflow.workflowId)).toBeUndefined()
    expect(fixture.workflows.list()).toEqual([])
    expect(fixture.runs.get(admittedRun.runId)?.workflowSnapshot).toEqual(fixture.workflow)
    expect(fixture.workflows.restoreDeletion(receipt.deletionId, '2026-08-25T10:00:05.000Z')).toBe(
      'UNDONE',
    )
    expect(fixture.workflows.get(fixture.workflow.workflowId)).toEqual(fixture.workflow)
  })

  it('persists current remote repositories by provider repository identity', async () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    const repository = {
      repositoryId: 'repository-api',
      name: 'API',
      provider: 'GITHUB',
      remoteId: '123',
      fullName: 'operator/api',
      cloneUrl: 'https://github.com/operator/api.git',
      webUrl: 'https://github.com/operator/api',
      defaultBranch: 'main',
      createdAt: '2026-08-23T12:00:00.000Z',
      updatedAt: '2026-08-23T12:00:00.000Z',
    } as const

    await fixture.repositories.add(repository)

    await expect(fixture.repositories.get(repository.repositoryId)).resolves.toEqual(repository)
    await expect(
      fixture.repositories.findByRemote(repository.provider, repository.remoteId),
    ).resolves.toEqual(repository)
    await expect(fixture.repositories.list()).resolves.toEqual([repository])
  })

  it('atomically stores immutable workflow, variable, and repository snapshots', () => {
    const workflow = createTestAgentWorkflow({
      repositoryIds: ['repository-api'],
      variables: ['task'],
      prompt: 'Implement {{ task }}.',
    })
    const fixture = createPersistenceFixture(workflow)
    fixtures.push(fixture)
    const mutableWorkflow = structuredClone(workflow)
    const mutableVariables = { task: { title: 'Persistence cleanup' } }

    fixture.runs.create({
      runId: TEST_RUN_ID,
      workflowId: workflow.workflowId,
      workflowSnapshot: mutableWorkflow,
      variables: mutableVariables,
      createdAt: workflow.createdAt,
      repositories: [
        {
          repositoryId: 'repository-api',
          name: 'API',
          provider: 'GITHUB',
          remoteId: '123',
          fullName: 'operator/api',
          cloneUrl: 'https://github.com/operator/api.git',
          defaultBranch: 'main',
          baseSha: 'a'.repeat(40),
        },
      ],
    })
    mutableWorkflow.name = 'Mutated'
    mutableVariables.task.title = 'Mutated'

    expect(fixture.runs.get(TEST_RUN_ID)).toMatchObject({
      workflowSnapshot: { name: 'Test workflow' },
      variables: { task: { title: 'Persistence cleanup' } },
      status: 'PENDING',
    })
    expect(fixture.runs.listRunRepositories(TEST_RUN_ID)).toMatchObject([
      {
        repositoryId: 'repository-api',
        provider: 'GITHUB',
        fullName: 'operator/api',
        isPrimary: true,
        baseSha: 'a'.repeat(40),
      },
    ])
    expect(fixture.events.list({ runId: TEST_RUN_ID, limit: 20 }).events).toMatchObject([
      { type: 'RUN_STARTED', data: { workflowId: workflow.workflowId } },
    ])
  })

  it('lists current runs with pagination and status filters', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)

    expect(fixture.runs.list({ page: 1, pageSize: 20 })).toMatchObject({
      data: [{ runId: TEST_RUN_ID, status: 'PENDING' }],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    })
    expect(fixture.runs.list({ page: 1, pageSize: 20, statuses: ['SUCCEEDED'] }).data).toEqual([])
  })

  it('lists only current node execution diagnostics with a required attempt id', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)
    getDatabaseHandle(fixture.database)
      .prepare(
        `INSERT INTO node_executions (
           node_execution_id, run_id, node_id, execution_index, attempt_id,
           status, output_json, outcome, started_at, completed_at, duration_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'node-execution-01',
        TEST_RUN_ID,
        'agent',
        1,
        'attempt-01',
        'SUCCEEDED',
        JSON.stringify({ summary: 'Done' }),
        'completed',
        '2026-08-23T12:00:00.000Z',
        '2026-08-23T12:00:01.000Z',
        1_000,
      )

    expect(fixture.runs.listNodeExecutions(TEST_RUN_ID)).toEqual([
      {
        nodeExecutionId: 'node-execution-01',
        attemptId: 'attempt-01',
        nodeId: 'agent',
        executionIndex: 1,
        status: 'SUCCEEDED',
        output: { summary: 'Done' },
        outcome: 'completed',
        errorCode: null,
        errorMessage: null,
        startedAt: '2026-08-23T12:00:00.000Z',
        completedAt: '2026-08-23T12:00:01.000Z',
        durationMs: 1_000,
      },
    ])
    expect(() =>
      getDatabaseHandle(fixture.database)
        .prepare(
          `INSERT INTO node_executions (
             node_execution_id, run_id, node_id, execution_index, attempt_id, status
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('node-execution-02', TEST_RUN_ID, 'agent', 2, '', 'PENDING'),
    ).toThrow()
  })

  it('rolls back a run whose repository evidence does not match the workflow', () => {
    const workflow = createTestAgentWorkflow({ repositoryIds: ['repository-api'] })
    const fixture = createPersistenceFixture(workflow)
    fixtures.push(fixture)

    expect(() =>
      fixture.runs.create({
        runId: TEST_RUN_ID,
        workflowId: workflow.workflowId,
        workflowSnapshot: workflow,
        variables: {},
        createdAt: workflow.createdAt,
        repositories: [],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'PERSISTENCE_VALIDATION_FAILED',
      }) satisfies Partial<PersistenceError>,
    )
    expect(fixture.runs.get(TEST_RUN_ID)).toBeUndefined()
  })
})
