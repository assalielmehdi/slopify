import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkflowSchema, type Workflow } from '@slopify/workflow-model'

import {
  RunServiceError,
  createRunService,
  type HarnessCatalog,
  type RunRepositoryResolution,
} from '../../src/index.js'
import { createPersistenceFixture, createTestAgentWorkflow } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const agentWorkflow = (): Workflow => {
  const workflow = createTestAgentWorkflow({
    createdAt: '2026-08-18T22:00:00Z',
    prompt: 'Implement {{ objective }} for {{repository}}. Escaped: \\{{ignored}}.',
    repositoryIds: ['repository-api'],
    primaryRepositoryId: 'repository-api',
    variables: ['objective', 'repository'],
  })
  const node = workflow.nodes[0]
  if (node === undefined) throw new Error('Expected an agent workflow')
  return WorkflowSchema.parse({
    ...workflow,
    nodes: [
      {
        ...node,
        harness: { harnessId: 'pi', modelId: 'test-model', thinkingLevel: 'medium' },
      },
    ],
  })
}

const createServiceFixture = (
  workflow: Workflow = agentWorkflow(),
  resolveRepository: (repositoryId: string) => Promise<RunRepositoryResolution> = async (
    repositoryId,
  ) => ({
    repositoryId: repositoryId as RunRepositoryResolution['repositoryId'],
    name: 'API',
    provider: 'GITHUB',
    remoteId: '123',
    fullName: 'operator/api',
    cloneUrl: 'https://github.com/operator/api.git',
    defaultBranch: 'main',
    baseSha: 'a'.repeat(40) as RunRepositoryResolution['baseSha'],
  }),
  harnesses: Pick<HarnessCatalog, 'requireAvailable'> = {
    requireAvailable: vi.fn(async () => ({
      harnessId: 'pi',
      name: 'Pi',
      description: 'Run workflows with Pi.',
      availability: 'AVAILABLE',
      executablePath: '/usr/local/bin/pi',
      version: '0.84.2',
      installHref: 'https://pi.dev/',
      installLabel: 'Install Pi',
      models: [{ id: 'test-model', name: 'test-model', thinkingLevels: ['medium'] }],
    })),
  },
) => {
  const fixture = createPersistenceFixture(workflow)
  fixtures.push(fixture)
  let identity = 0
  const service = createRunService({
    events: fixture.events,
    runs: fixture.runs,
    workflows: fixture.workflows,
    resolveRepository,
    harnesses,
    now: () => '2026-08-18T22:30:00Z',
    createRunId: () => `run-service-${++identity}`,
  })
  return { fixture, service }
}

const createInput = {
  workflowId: 'test-workflow',
  variables: { objective: 'the run API', repository: 'Slopify' },
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

  it('snapshots the workflow and its exact supplied variables', async () => {
    const { fixture, service } = createServiceFixture()

    const run = await service.create(createInput)
    const detail = service.get(run.runId)

    expect(run).toMatchObject({
      runId: 'run-service-1',
      status: 'PENDING',
      workflowSnapshot: fixture.workflow,
      variables: { objective: 'the run API', repository: 'Slopify' },
    })
    expect(detail).toMatchObject({
      run,
      events: [{ type: 'RUN_STARTED', sequence: 1, data: { workflowId: 'test-workflow' } }],
      repositories: [
        {
          repositoryId: 'repository-api',
          position: 0,
          name: 'API',
          provider: 'GITHUB',
          remoteId: '123',
          fullName: 'operator/api',
          cloneUrl: 'https://github.com/operator/api.git',
          defaultBranch: 'main',
          baseSha: 'a'.repeat(40),
          isPrimary: true,
        },
      ],
      repositoryWorkspaces: [],
    })
  })

  it('rejects missing workflow variables before persisting a run', async () => {
    const { service } = createServiceFixture()

    await expect(
      service.create({ workflowId: 'test-workflow', variables: { objective: 'the API' } }),
    ).rejects.toMatchObject({
      code: 'RUN_VARIABLES_INVALID',
    } satisfies Partial<RunServiceError>)
    expect(service.list({ page: 1, pageSize: 20 }).data).toEqual([])
  })

  it('rejects variables that are not declared by the workflow', async () => {
    const { service } = createServiceFixture()

    await expect(
      service.create({
        workflowId: 'test-workflow',
        variables: { objective: 'the API', repository: 'Slopify', unexpected: true },
      }),
    ).rejects.toMatchObject({ code: 'RUN_VARIABLES_INVALID' } satisfies Partial<RunServiceError>)
  })

  it('requires every configured repository to be available before admitting the run', async () => {
    const workflow = {
      ...agentWorkflow(),
      configuration: {
        repositoryIds: ['repository-api'],
        primaryRepositoryId: 'repository-api',
        variables: ['objective', 'repository'],
      },
    }
    const resolveRepository = vi.fn(async () => {
      throw new Error('missing')
    })
    const { service } = createServiceFixture(workflow, resolveRepository)

    await expect(service.create(createInput)).rejects.toMatchObject({
      code: 'WORKFLOW_REPOSITORY_UNAVAILABLE',
    } satisfies Partial<RunServiceError>)
    expect(resolveRepository).toHaveBeenCalledWith('repository-api')
  })

  it('requires every agent harness and selected model to be available before admission', async () => {
    const harnesses = {
      requireAvailable: vi.fn(async () => {
        throw new Error('missing')
      }),
    }
    const { service } = createServiceFixture(agentWorkflow(), undefined, harnesses)

    await expect(service.create(createInput)).rejects.toMatchObject({
      code: 'WORKFLOW_HARNESS_UNAVAILABLE',
    } satisfies Partial<RunServiceError>)
    expect(harnesses.requireAvailable).toHaveBeenCalledWith('pi', 'test-model', 'medium')
  })

  it('rejects an agent workflow without a primary repository', async () => {
    const workflow = {
      ...agentWorkflow(),
      configuration: {
        repositoryIds: [],
        primaryRepositoryId: null,
        variables: ['objective', 'repository'],
      },
    }
    const { service } = createServiceFixture(workflow)

    await expect(service.create(createInput)).rejects.toMatchObject({
      code: 'WORKFLOW_NOT_RUNNABLE',
    } satisfies Partial<RunServiceError>)
  })

  it('rejects an empty draft as not runnable', async () => {
    const workflow = {
      ...agentWorkflow(),
      startNodeId: null,
      nodes: [],
      edges: [],
      maxTransitions: 0,
    }
    const { service } = createServiceFixture(workflow)

    await expect(service.create({ workflowId: workflow.workflowId })).rejects.toMatchObject({
      code: 'WORKFLOW_NOT_RUNNABLE',
    } satisfies Partial<RunServiceError>)
  })

  it('reads the workflow and variables captured by the run after live data changes', async () => {
    const { fixture, service } = createServiceFixture()
    const variables = { objective: 'the API', repository: 'Slopify' }
    const run = await service.create({ workflowId: fixture.workflow.workflowId, variables })
    variables.objective = 'mutated after create'

    fixture.workflows.save({
      ...fixture.workflow,
      name: 'Changed after the run started',
      updatedAt: '2026-08-18T23:00:00Z',
    })

    expect(service.get(run.runId)?.run).toMatchObject({
      workflowSnapshot: fixture.workflow,
      variables: { objective: 'the API', repository: 'Slopify' },
    })
  })
})

describe('run service inspection', () => {
  it('returns newest-first pages containing only run execution information', async () => {
    const { service } = createServiceFixture()
    await service.create(createInput)
    const second = await service.create(createInput)

    const page = service.list({ page: 1, pageSize: 1 })

    expect(page.pagination).toEqual({ page: 1, pageSize: 1, totalItems: 2, totalPages: 2 })
    expect(page.data).toEqual([
      {
        runId: second.runId,
        workflowId: 'test-workflow',
        status: 'PENDING',
        createdAt: '2026-08-18T22:30:00Z',
        startedAt: null,
        completedAt: null,
        durationMs: null,
      },
    ])
  })

  it('filters the complete run history before applying pagination', async () => {
    const { service } = createServiceFixture()
    const matching = await service.create(createInput)
    await service.create(createInput)

    const page = service.list({
      page: 1,
      pageSize: 1,
      runId: 'service-1',
      statuses: ['PENDING'],
    })

    expect(page.pagination).toEqual({ page: 1, pageSize: 1, totalItems: 1, totalPages: 1 })
    expect(page.data).toEqual([
      expect.objectContaining({
        runId: matching.runId,
        status: 'PENDING',
        durationMs: null,
      }),
    ])
  })
})
