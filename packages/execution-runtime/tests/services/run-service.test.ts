import { afterEach, describe, expect, it } from 'vitest'

import {
  RunServiceError,
  createRunService,
  type ReadinessService,
  type RunTaskResolver,
} from '../../src/index.js'
import {
  TEST_PROFILE_ID,
  TEST_REVISION_ID,
  TEST_WORKFLOW_ID,
  createPersistenceFixture,
} from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const createServiceFixture = (ready = true) => {
  const fixture = createPersistenceFixture()
  fixtures.push(fixture)
  const readiness: ReadinessService = {
    connectorStatus: () => ({ clickup: ready, gitlab: ready, modelProvider: ready }),
    check: async () => ({
      profileId: TEST_PROFILE_ID,
      ready,
      repositories: fixture.snapshot.repositories.map(({ repositoryId }) => ({
        repositoryId,
        ready,
        findings: ready
          ? []
          : [
              {
                category: 'clickup' as const,
                code: 'CLICKUP_UNAVAILABLE',
                message: 'ClickUp credentials are unavailable',
              },
            ],
      })),
    }),
  }
  const tasks: RunTaskResolver = {
    resolve: async (taskReference) => ({ id: 'TASK-1', name: 'Implement run API', taskReference }),
  }
  let identity = 0
  const service = createRunService({
    events: fixture.events,
    profiles: fixture.profiles,
    readiness,
    runs: fixture.runs,
    tasks,
    workflows: fixture.workflows,
    now: () => '2026-08-18T22:30:00Z',
    createRunId: () => `run-service-${++identity}`,
    createProfileSnapshotId: () => `snapshot-service-${identity}`,
  })
  return { fixture, service }
}

const createInput = {
  taskReference: 'TASK-1',
  workflowId: TEST_WORKFLOW_ID,
  revisionId: TEST_REVISION_ID,
  profileId: TEST_PROFILE_ID,
}

describe('run service admission', () => {
  it('rejects new runs after admissions close for shutdown', async () => {
    const { service } = createServiceFixture()

    service.stopAdmissions()

    await expect(service.create(createInput)).rejects.toMatchObject({
      code: 'RUN_ADMISSION_CLOSED',
    } satisfies Partial<RunServiceError>)
    expect(service.list({ page: 1, pageSize: 20 }).data).toEqual([])
  })

  it('validates readiness and snapshots the exact task, profile, and workflow configuration', async () => {
    const { fixture, service } = createServiceFixture()

    const run = await service.create(createInput)
    const detail = service.get(run.runId)

    expect(run).toMatchObject({
      runId: 'run-service-1',
      status: 'PENDING',
      taskSnapshot: {
        id: 'TASK-1',
        name: 'Implement run API',
        taskReference: 'TASK-1',
      },
    })
    expect(detail).toMatchObject({
      run,
      workflowRevision: fixture.revision,
      profileSnapshot: {
        snapshotId: 'snapshot-service-1',
        profileId: TEST_PROFILE_ID,
      },
      events: [{ type: 'RUN_STARTED', sequence: 1 }],
    })
    expect(detail?.profileSnapshot.repositories.map(({ repositoryId }) => repositoryId)).toEqual([
      'api',
      'web',
      'docs',
    ])
  })

  it('admits independent runs concurrently', async () => {
    const { service } = createServiceFixture()
    const first = await service.create(createInput)
    const second = await service.create({ ...createInput, taskReference: 'TASK-2' })

    expect(service.list({ page: 1, pageSize: 20 })).toMatchObject({
      data: [
        expect.objectContaining({ runId: second.runId, status: second.status }),
        expect.objectContaining({ runId: first.runId, status: first.status }),
      ],
      pagination: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 },
    })
    expect(service.get(first.runId)?.run).toEqual(first)
    expect(service.get(second.runId)?.run).toEqual(second)
  })

  it('rejects an unready profile before creating a run', async () => {
    const { service } = createServiceFixture(false)

    await expect(service.create(createInput)).rejects.toMatchObject({
      code: 'PROFILE_NOT_READY',
    } satisfies Partial<RunServiceError>)
    expect(service.list({ page: 1, pageSize: 20 }).data).toEqual([])
  })
})

describe('run service inspection', () => {
  it('returns newest-first pages with stable run, profile, and delivery summaries', async () => {
    const { fixture, service } = createServiceFixture()
    const first = await service.create(createInput)
    fixture.runs.completeRun({
      runId: first.runId,
      expectedStatus: 'PENDING',
      status: 'SUCCEEDED',
      durationMs: 2_000,
      timestamp: '2026-08-18T22:30:02Z',
    })
    const second = await service.create({ ...createInput, taskReference: 'TASK-2' })

    const page = service.list({ page: 1, pageSize: 1 })

    expect(page.pagination).toEqual({ page: 1, pageSize: 1, totalItems: 2, totalPages: 2 })
    expect(page.data).toEqual([
      expect.objectContaining({
        runId: second.runId,
        taskReference: 'TASK-2',
        profileId: TEST_PROFILE_ID,
        profileDisplayName: 'Local profile',
        workflowId: TEST_WORKFLOW_ID,
        revisionId: TEST_REVISION_ID,
        status: 'PENDING',
        durationMs: null,
        failedNodeId: null,
        mergeRequestUrls: [],
      }),
    ])
  })

  it('reproduces the exact execution path, timings, output, artifacts, evidence, and errors', async () => {
    const { fixture, service } = createServiceFixture()
    const run = await service.create(createInput)
    fixture.runs.changeStatus({
      runId: run.runId,
      expectedStatus: 'PENDING',
      status: 'RUNNING',
      timestamp: '2026-08-18T22:30:01Z',
    })
    fixture.runs.selectRepositories({
      runId: run.runId,
      selectedAt: '2026-08-18T22:30:02Z',
      selection: {
        selected: [
          {
            repositoryId: 'api',
            rationale: 'API owns the run boundary',
            responsibility: 'Implement the API',
          },
        ],
        excluded: [
          { repositoryId: 'web', rationale: 'No UI change' },
          { repositoryId: 'docs', rationale: 'No documentation change' },
        ],
      },
    })
    fixture.runs.recordWorkspace({
      runId: run.runId,
      repositoryId: 'api',
      repositoryPath: '/workspace/api',
      worktreePath: '/worktrees/api-run',
      remote: 'origin',
      targetBranch: 'main',
      sourceBranch: 'ai/task-1-run',
      baseSha: '0123456789abcdef',
      createdAt: '2026-08-18T22:30:03Z',
    })
    fixture.runs.startNode({
      runId: run.runId,
      nodeExecutionId: 'node-execution-service-1',
      nodeId: 'load-clickup-task',
      inputReferences: [{ kind: 'task', id: 'TASK-1' }],
      timestamp: '2026-08-18T22:30:04Z',
    })
    fixture.runs.recordOutput({
      runId: run.runId,
      nodeExecutionId: 'node-execution-service-1',
      nodeId: 'load-clickup-task',
      channel: 'stdout',
      content: 'loading task',
      repositoryId: 'api',
      timestamp: '2026-08-18T22:30:05Z',
    })
    fixture.runs.recordArtifact({
      artifactId: 'artifact-service-1',
      runId: run.runId,
      nodeExecutionId: 'node-execution-service-1',
      nodeId: 'load-clickup-task',
      artifactType: 'EXECUTION_PLAN',
      content: '# Plan',
      metadata: { source: 'test' },
      timestamp: '2026-08-18T22:30:06Z',
    })
    fixture.runs.upsertDeliveryEvidence({
      runId: run.runId,
      repositoryId: 'api',
      status: 'MERGE_REQUEST_CREATED',
      mergeRequestUrl: 'https://gitlab.example/group/api/-/merge_requests/7',
      evidence: { verified: false },
      updatedAt: '2026-08-18T22:30:07Z',
    })
    fixture.runs.failNodeAndRun({
      runId: run.runId,
      nodeExecutionId: 'node-execution-service-1',
      nodeId: 'load-clickup-task',
      nodeStatus: 'FAILED',
      runStatus: 'FAILED',
      code: 'TASK_LOAD_FAILED',
      message: 'Task could not be loaded',
      nodeDurationMs: 4_000,
      runDurationMs: 8_000,
      timestamp: '2026-08-18T22:30:09Z',
    })

    const detail = service.get(run.runId)

    expect(detail).toMatchObject({
      repositorySelection: {
        selected: [{ repositoryId: 'api', responsibility: 'Implement the API' }],
        excluded: [{ repositoryId: 'web' }, { repositoryId: 'docs' }],
      },
      workspaces: [
        {
          repositoryId: 'api',
          worktreePath: '/worktrees/api-run',
          baseSha: '0123456789abcdef',
        },
      ],
      nodeExecutions: [
        {
          nodeId: 'load-clickup-task',
          status: 'FAILED',
          durationMs: 4_000,
          errorCode: 'TASK_LOAD_FAILED',
          errorMessage: 'Task could not be loaded',
        },
      ],
      outputChunks: [{ content: 'loading task', repositoryId: 'api' }],
      artifacts: [{ artifactId: 'artifact-service-1', content: '# Plan' }],
      deliveryEvidence: [
        {
          repositoryId: 'api',
          mergeRequestUrl: 'https://gitlab.example/group/api/-/merge_requests/7',
        },
      ],
    })
    expect(detail?.events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})
