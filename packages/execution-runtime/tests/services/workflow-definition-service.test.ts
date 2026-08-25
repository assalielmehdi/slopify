import { describe, expect, it, vi } from 'vitest'

import { WorkflowFileSchema, type WorkflowFile } from '@slopify/workflow-model'

import {
  HarnessCatalogError,
  WorkflowServiceError,
  WorkflowStoreError,
  calculateResourceRevision,
  createWorkflowDefinitionService,
  parseWorkflowSource,
  type HarnessCatalog,
  type WorkflowSource,
  type WorkflowStore,
} from '../../src/index.js'

const workflow = (overrides: Partial<WorkflowFile> = {}): WorkflowFile =>
  WorkflowFileSchema.parse({
    schemaVersion: 2,
    workflowId: 'release-review',
    name: 'Release review',
    description: 'Prepare and review a release.',
    repositories: { repositoryIds: [], primaryRepositoryId: null },
    variables: ['release'],
    graph: {
      startNodeId: 'prepare',
      nodes: [
        {
          type: 'agent',
          id: 'prepare',
          name: 'Prepare',
          prompt: 'Prepare {{ release }}.',
          harness: { harnessId: 'pi' },
        },
      ],
      edges: [],
      maxTransitions: 24,
    },
    createdAt: '2026-08-25T10:00:00.000Z',
    updatedAt: '2026-08-25T10:00:00.000Z',
    ...overrides,
  })

const source = (value: WorkflowFile): WorkflowSource => {
  const contents = `${JSON.stringify(value, null, 2)}\n`
  return parseWorkflowSource({
    workflowId: value.workflowId,
    source: contents,
    revision: calculateResourceRevision(contents),
  })
}

const store = (entries: readonly WorkflowSource[] = []): WorkflowStore => ({
  create: vi.fn(async (value) => ({
    value,
    revision: calculateResourceRevision(`${JSON.stringify(value, null, 2)}\n`),
  })),
  save: vi.fn(async ({ value }) => ({
    value,
    revision: calculateResourceRevision(`${JSON.stringify(value, null, 2)}\n`),
  })),
  get: vi.fn(async (workflowId) => entries.find((entry) => entry.workflowId === workflowId)),
  list: vi.fn(async () => entries),
})

const harnesses = (availability: 'AVAILABLE' | 'UNAVAILABLE' = 'AVAILABLE'): HarnessCatalog => ({
  list: vi.fn(),
  get: vi.fn(),
  requireAvailable: vi.fn(async () => {
    if (availability === 'UNAVAILABLE') {
      throw new HarnessCatalogError('HARNESS_UNAVAILABLE', 'Pi is not installed')
    }
    return {
      harnessId: 'pi',
      name: 'Pi',
      description: 'Run workflows with Pi.',
      availability: 'AVAILABLE',
      executablePath: '/usr/local/bin/pi',
      version: '0.84.2',
      installHref: 'https://pi.dev/',
      installLabel: 'Install Pi',
      models: [],
    }
  }),
})

describe('workflow definition service', () => {
  it('creates an empty draft with the user-selected immutable slug', async () => {
    const workflows = store()
    const service = createWorkflowDefinitionService({
      workflows,
      harnesses: harnesses(),
      now: () => '2026-08-25T12:00:00.000Z',
    })

    const created = await service.create({
      workflowId: 'release-review',
      name: 'Release review',
      description: 'Prepare and review a release.',
    })

    expect(created).toMatchObject({
      status: 'VALID',
      workflowId: 'release-review',
      runnable: false,
      readiness: [{ code: 'WORKFLOW_EMPTY_GRAPH', path: ['graph', 'nodes'] }],
      value: {
        repositories: { repositoryIds: [], primaryRepositoryId: null },
        variables: [],
        graph: { startNodeId: null, nodes: [], edges: [] },
        createdAt: '2026-08-25T12:00:00.000Z',
        updatedAt: '2026-08-25T12:00:00.000Z',
      },
    })
    expect(workflows.create).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'release-review' }),
    )
  })

  it('maps an existing user slug to a stable conflict', async () => {
    const workflows = store()
    vi.mocked(workflows.create).mockRejectedValueOnce(
      new WorkflowStoreError('WORKFLOW_CONFLICT', 'Workflow already exists'),
    )
    const service = createWorkflowDefinitionService({ workflows, harnesses: harnesses() })

    await expect(
      service.create({
        workflowId: 'release-review',
        name: 'Release review',
        description: 'Prepare and review a release.',
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_ID_CONFLICT' })
  })

  it('keeps invalid raw source visible without pretending it was parsed', async () => {
    const contents = '{ "schemaVersion": 2, invalid json'
    const invalid = parseWorkflowSource({
      workflowId: 'broken-workflow',
      source: contents,
      revision: calculateResourceRevision(contents),
    })
    const service = createWorkflowDefinitionService({
      workflows: store([invalid]),
      harnesses: harnesses(),
    })

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        status: 'INVALID',
        workflowId: 'broken-workflow',
        diagnostics: [expect.objectContaining({ code: 'WORKFLOW_FILE_MALFORMED' })],
      }),
    ])
    const raw = await service.getSource('broken-workflow')
    expect(raw).toMatchObject({ status: 'INVALID', source: contents })
    expect('value' in raw).toBe(false)
  })

  it('reports host harness readiness without invalidating portable definitions', async () => {
    const portable = source(workflow())
    const service = createWorkflowDefinitionService({
      workflows: store([portable]),
      harnesses: harnesses('UNAVAILABLE'),
    })

    await expect(service.get('release-review')).resolves.toMatchObject({
      status: 'VALID',
      runnable: false,
      readiness: [
        {
          code: 'HARNESS_UNAVAILABLE',
          message: 'Pi is not installed',
          path: ['graph', 'nodes', 0, 'harness', 'harnessId'],
        },
      ],
      value: { workflowId: 'release-review' },
    })
  })

  it('marks a valid non-empty workflow runnable when its harness is ready', async () => {
    const service = createWorkflowDefinitionService({
      workflows: store([source(workflow())]),
      harnesses: harnesses(),
    })

    await expect(service.get('release-review')).resolves.toMatchObject({
      status: 'VALID',
      runnable: true,
      readiness: [],
    })
  })

  it('requires the current revision on save and preserves immutable fields', async () => {
    const current = source(workflow())
    const workflows = store([current])
    const service = createWorkflowDefinitionService({
      workflows,
      harnesses: harnesses(),
      now: () => '2026-08-25T13:00:00.000Z',
    })

    const updated = await service.update('release-review', {
      value: workflow({
        name: 'Updated review',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z',
      }),
      expectedRevision: current.revision,
    })

    expect(updated).toMatchObject({
      status: 'VALID',
      value: {
        workflowId: 'release-review',
        name: 'Updated review',
        createdAt: '2026-08-25T10:00:00.000Z',
        updatedAt: '2026-08-25T13:00:00.000Z',
      },
    })
    expect(workflows.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'release-review',
        expectedRevision: current.revision,
      }),
    )

    vi.mocked(workflows.save).mockRejectedValueOnce(
      new WorkflowStoreError('WORKFLOW_REVISION_CONFLICT', 'Workflow changed since it was read'),
    )
    await expect(
      service.update('release-review', {
        value: workflow(),
        expectedRevision: current.revision,
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_REVISION_CONFLICT' })
  })

  it('rejects an update that attempts to change the workflow slug', async () => {
    const current = source(workflow())
    const service = createWorkflowDefinitionService({
      workflows: store([current]),
      harnesses: harnesses(),
    })

    await expect(
      service.update('release-review', {
        value: workflow({ workflowId: 'different-workflow' }),
        expectedRevision: current.revision,
      }),
    ).rejects.toMatchObject({
      code: 'WORKFLOW_ID_MISMATCH',
    } satisfies Partial<WorkflowServiceError>)
  })
})
