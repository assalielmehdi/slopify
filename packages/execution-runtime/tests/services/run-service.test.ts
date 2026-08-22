import { afterEach, describe, expect, it } from 'vitest'

import { createPredefinedV1Workflow, type Workflow } from '@loop/workflow-model'

import { RunServiceError, createRunService } from '../../src/index.js'
import { createPersistenceFixture } from '../persistence/test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const agentWorkflow = (): Workflow => {
  const workflow = createPredefinedV1Workflow({
    createdAt: '2026-08-18T22:00:00Z',
    agentDefaults: {
      provider: 'test-provider',
      model: 'test-model',
      thinkingLevel: 'medium',
    },
  })
  const node = workflow.nodes[0]
  if (node?.type !== 'agent') throw new Error('Expected the predefined workflow to be agent-only')
  return {
    ...workflow,
    nodes: [
      {
        ...node,
        job: {
          ...node.job,
          prompt: 'Implement {{ objective }} for {{project}}. Escaped: \\{{ignored}}.',
        },
      },
    ],
  }
}

const createServiceFixture = (workflow: Workflow = agentWorkflow()) => {
  const fixture = createPersistenceFixture(workflow)
  fixtures.push(fixture)
  let identity = 0
  const service = createRunService({
    events: fixture.events,
    runs: fixture.runs,
    workflows: fixture.workflows,
    now: () => '2026-08-18T22:30:00Z',
    createRunId: () => `run-service-${++identity}`,
  })
  return { fixture, service }
}

const createInput = {
  workflowId: 'delivery-workflow',
  variables: { objective: 'the run API', project: 'Slopify' },
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

  it('snapshots the workflow, supplied variables, and missing-variable decision', async () => {
    const { fixture, service } = createServiceFixture()

    const run = await service.create(createInput)
    const detail = service.get(run.runId)

    expect(run).toMatchObject({
      runId: 'run-service-1',
      status: 'PENDING',
      workflowSnapshot: fixture.workflow,
      variables: { objective: 'the run API', project: 'Slopify' },
      missingVariables: [],
    })
    expect(detail).toMatchObject({
      run,
      events: [{ type: 'RUN_STARTED', sequence: 1, data: { workflowId: 'delivery-workflow' } }],
    })
    expect(detail).not.toHaveProperty('profileSnapshot')
    expect(detail?.run).not.toHaveProperty('taskReference')
    expect(detail?.run).not.toHaveProperty('taskSnapshot')
  })

  it('reports every missing prompt variable before persisting a run', async () => {
    const { service } = createServiceFixture()

    await expect(
      service.create({ workflowId: 'delivery-workflow', variables: { objective: 'the API' } }),
    ).rejects.toMatchObject({
      code: 'RUN_VARIABLES_MISSING',
      missingVariables: ['project'],
    } satisfies Partial<RunServiceError>)
    expect(service.list({ page: 1, pageSize: 20 }).data).toEqual([])
  })

  it('persists confirmed missing variables as part of the immutable run input', async () => {
    const { service } = createServiceFixture()

    const run = await service.create({
      workflowId: 'delivery-workflow',
      variables: { objective: 'the API' },
      confirmMissingVariables: true,
    })

    expect(run).toMatchObject({
      variables: { objective: 'the API' },
      missingVariables: ['project'],
    })
  })

  it.each([
    {
      name: 'empty draft',
      workflow: {
        ...agentWorkflow(),
        startNodeId: null,
        nodes: [],
        edges: [],
        maxTransitions: 0,
      },
    },
    {
      name: 'workflow containing a non-agent node',
      workflow: {
        ...agentWorkflow(),
        startNodeId: 'command',
        nodes: [
          {
            type: 'command' as const,
            id: 'command',
            name: 'Command',
            description: 'Historical command node',
            timeoutSeconds: 60,
            commandId: 'historical-command',
            outcomes: ['completed'],
          },
        ],
        edges: [],
        maxTransitions: 0,
      },
    },
  ])('rejects a $name as not runnable in V1', async ({ workflow }) => {
    const { service } = createServiceFixture(workflow)

    await expect(service.create({ workflowId: workflow.workflowId })).rejects.toMatchObject({
      code: 'WORKFLOW_NOT_RUNNABLE',
    } satisfies Partial<RunServiceError>)
  })

  it('reads the workflow and variables captured by the run after live data changes', async () => {
    const { fixture, service } = createServiceFixture()
    const variables = { objective: 'the API', project: 'Slopify' }
    const run = await service.create({ workflowId: fixture.workflow.workflowId, variables })
    variables.objective = 'mutated after create'

    fixture.workflows.save({
      ...fixture.workflow,
      name: 'Changed after the run started',
      updatedAt: '2026-08-18T23:00:00Z',
    })

    expect(service.get(run.runId)?.run).toMatchObject({
      workflowSnapshot: fixture.workflow,
      variables: { objective: 'the API', project: 'Slopify' },
    })
  })
})

describe('run service inspection', () => {
  it('returns newest-first pages containing only run execution information', async () => {
    const { fixture, service } = createServiceFixture()
    const first = await service.create(createInput)
    fixture.runs.completeRun({
      runId: first.runId,
      expectedStatus: 'PENDING',
      status: 'SUCCEEDED',
      durationMs: 2_000,
      timestamp: '2026-08-18T22:30:02Z',
    })
    const second = await service.create(createInput)

    const page = service.list({ page: 1, pageSize: 1 })

    expect(page.pagination).toEqual({ page: 1, pageSize: 1, totalItems: 2, totalPages: 2 })
    expect(page.data).toEqual([
      {
        runId: second.runId,
        workflowId: 'delivery-workflow',
        status: 'PENDING',
        createdAt: '2026-08-18T22:30:00Z',
        startedAt: null,
        completedAt: null,
        durationMs: null,
      },
    ])
  })
})
