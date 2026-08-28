import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  calculateResourceRevision,
  createFilesystemWorkflowStore,
  createWorkflowDefinitionService,
  resolveSlopifyPaths,
  type RepositoryService,
} from '@slopify/execution-runtime'
import { WorkflowFileSchema, type WorkflowFile } from '@slopify/workflow-model'
import { afterEach, describe, expect, it } from 'vitest'

import { createTestHarnessCatalog } from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { createApiApp } from '../src/app.js'

const directories: string[] = []

const createFixture = (options: { readonly hasActiveRun?: boolean } = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-workflows-api-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  const store = createFilesystemWorkflowStore({ paths })
  const workflows = createWorkflowDefinitionService({
    workflows: store,
    harnesses: createTestHarnessCatalog(),
    runActivity: { hasActive: async () => options.hasActiveRun ?? false },
    now: () => '2026-08-25T14:00:00.000Z',
  })
  return { app: createApiApp({ workflows }), paths, workflows }
}

const createWorkflow = async (app: ReturnType<typeof createApiApp>) => {
  const response = await app.request('/api/workflows', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowId: 'release-review',
      description: 'Prepare and review a release.',
    }),
  })
  const body = (await response.clone().json()) as { readonly value?: unknown }
  return { response, value: WorkflowFileSchema.parse(body.value) }
}

const putWorkflow = (app: ReturnType<typeof createApiApp>, workflow: WorkflowFile, etag?: string) =>
  app.request(`/api/workflows/${workflow.workflowId}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(etag === undefined ? {} : { 'if-match': etag }),
    },
    body: JSON.stringify(workflow),
  })

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('workflow API', () => {
  it('creates a valid empty draft with an explicit name and revision', async () => {
    const { app, paths } = createFixture()

    const { response, value } = await createWorkflow(app)

    expect(response.status).toBe(201)
    expect(response.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/u)
    expect(value).toMatchObject({
      workflowId: 'release-review',
      repositories: { repositoryIds: [], primaryRepositoryId: null },
      variables: [],
      graph: { startNodeId: null, nodes: [], edges: [] },
    })
    expect(await response.json()).toMatchObject({
      status: 'VALID',
      workflowId: 'release-review',
      runnable: false,
      readiness: [{ code: 'WORKFLOW_EMPTY_GRAPH' }],
    })
    expect(
      JSON.parse(readFileSync(paths.workflow('release-review').definitionFile, 'utf8')),
    ).toEqual(value)
  })

  it('rejects a second display name beside the canonical workflow name', async () => {
    const { app } = createFixture()

    const response = await app.request('/api/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: 'test',
        name: 'test wer',
        description: 'Test workflow.',
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    await expect(app.request('/api/workflows').then((result) => result.json())).resolves.toEqual({
      workflows: [],
    })
  })

  it('returns a stable conflict for an existing name', async () => {
    const { app } = createFixture()
    await createWorkflow(app)

    const duplicate = await app.request('/api/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: 'release-review',
        description: 'This still uses the same immutable name.',
      }),
    })

    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toEqual({
      error: { code: 'WORKFLOW_ID_CONFLICT', message: 'Workflow ID already exists' },
    })
  })

  it('lists valid and invalid definitions without exposing raw source in the catalog', async () => {
    const { app, paths } = createFixture()
    await createWorkflow(app)
    const brokenDirectory = paths.workflow('broken-workflow').directory
    mkdirSync(brokenDirectory, { recursive: true })
    writeFileSync(paths.workflow('broken-workflow').definitionFile, '{ invalid')

    const response = await app.request('/api/workflows')
    const body = (await response.json()) as { readonly workflows: readonly unknown[] }

    expect(response.status).toBe(200)
    expect(body.workflows).toHaveLength(2)
    expect(body.workflows).toContainEqual(
      expect.objectContaining({ status: 'VALID', workflowId: 'release-review' }),
    )
    const invalid = body.workflows.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'workflowId' in entry &&
        entry.workflowId === 'broken-workflow',
    )
    expect(invalid).toMatchObject({
      status: 'INVALID',
      diagnostics: [expect.objectContaining({ code: 'WORKFLOW_FILE_MALFORMED' })],
    })
    expect(invalid).not.toHaveProperty('source')
    expect(invalid).not.toHaveProperty('value')
  })

  it('returns the complete workflow screen through one additive BFF endpoint', async () => {
    const { workflows } = createFixture()
    const repositories = {
      add: async () => {
        throw new Error('Not used')
      },
      delete: async () => undefined,
      list: async () => [],
      requireAvailable: async () => {
        throw new Error('Not used')
      },
    } satisfies RepositoryService
    const app = createApiApp({
      workflows,
      harnesses: createTestHarnessCatalog(),
      repositories,
    })
    await createWorkflow(app)

    const response = await app.request('/api/screens/workflow?workflowId=release-review')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({
      selectedWorkflowId: 'release-review',
      workflows: [{ status: 'VALID', workflowId: 'release-review' }],
      harnesses: [],
      repositories: [],
    })
  })

  it('returns exact invalid source and diagnostics with its revision ETag', async () => {
    const { app, paths } = createFixture()
    const source = '{ "schemaVersion": 2, invalid json'
    mkdirSync(paths.workflow('broken-workflow').directory, { recursive: true })
    writeFileSync(paths.workflow('broken-workflow').definitionFile, source)

    const response = await app.request('/api/workflows/broken-workflow/source')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe(`"${calculateResourceRevision(source)}"`)
    expect(body).toMatchObject({
      status: 'INVALID',
      workflowId: 'broken-workflow',
      source,
      diagnostics: [expect.objectContaining({ code: 'WORKFLOW_FILE_MALFORMED' })],
    })
    expect(body).not.toHaveProperty('value')
  })

  it('returns the current catalog entry and ETag for one workflow', async () => {
    const { app } = createFixture()
    const created = await createWorkflow(app)

    const response = await app.request('/api/workflows/release-review')

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe(created.response.headers.get('etag'))
    expect(await response.json()).toMatchObject({
      status: 'VALID',
      workflowId: 'release-review',
      value: { workflowId: 'release-review' },
    })
  })

  it('archives the complete workflow directory through its resource route', async () => {
    const { app, paths } = createFixture()
    await createWorkflow(app)
    const historicalRunDirectory = join(paths.workflow('release-review').runsDirectory, 'run-01')
    mkdirSync(historicalRunDirectory, { recursive: true })
    writeFileSync(join(historicalRunDirectory, 'run.json'), '{}\n')

    const response = await app.request('/api/workflows/release-review', { method: 'DELETE' })

    expect(response.status).toBe(204)
    expect(existsSync(paths.workflow('release-review').directory)).toBe(false)
    expect(existsSync(join(paths.archiveDirectory, 'release-review', 'workflow.json'))).toBe(true)
    expect(
      existsSync(join(paths.archiveDirectory, 'release-review', 'runs', 'run-01', 'run.json')),
    ).toBe(true)
    await expect(app.request('/api/workflows').then((result) => result.json())).resolves.toEqual({
      workflows: [],
    })
  })

  it('refuses to archive a workflow while one of its runs is active', async () => {
    const { app, paths } = createFixture({ hasActiveRun: true })
    await createWorkflow(app)

    const response = await app.request('/api/workflows/release-review', { method: 'DELETE' })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: 'WORKFLOW_RUN_ACTIVE',
        message: 'Workflow cannot be archived while a run is pending or running',
      },
    })
    expect(existsSync(paths.workflow('release-review').definitionFile)).toBe(true)
    expect(existsSync(join(paths.archiveDirectory, 'release-review'))).toBe(false)
  })

  it('returns the workflow not-found envelope when deleting an unknown workflow', async () => {
    const { app } = createFixture()

    const response = await app.request('/api/workflows/unknown', { method: 'DELETE' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow was not found' },
    })
  })

  it('requires one current If-Match value and rejects stale external edits', async () => {
    const { app, paths } = createFixture()
    const created = await createWorkflow(app)
    const updatedValue = { ...created.value, description: 'Updated review' }

    const missing = await putWorkflow(app, updatedValue)
    expect(missing.status).toBe(428)
    expect(await missing.json()).toMatchObject({
      error: { code: 'WORKFLOW_PRECONDITION_REQUIRED' },
    })

    const malformed = await putWorkflow(app, updatedValue, 'not-an-etag')
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: { code: 'WORKFLOW_ETAG_INVALID' } })

    const external = `${JSON.stringify({ ...created.value, description: 'External review' }, null, 2)}\n`
    writeFileSync(paths.workflow('release-review').definitionFile, external)
    const stale = await putWorkflow(app, updatedValue, created.response.headers.get('etag') ?? '')

    expect(stale.status).toBe(412)
    expect(await stale.json()).toMatchObject({
      error: { code: 'WORKFLOW_REVISION_CONFLICT' },
    })
    expect(readFileSync(paths.workflow('release-review').definitionFile, 'utf8')).toBe(external)
  })

  it('updates with the current revision and returns the replacement ETag', async () => {
    const { app } = createFixture()
    const created = await createWorkflow(app)
    const initialEtag = created.response.headers.get('etag')

    const response = await putWorkflow(
      app,
      { ...created.value, description: 'Updated review' },
      initialEtag ?? '',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/u)
    expect(response.headers.get('etag')).not.toBe(initialEtag)
    expect(await response.json()).toMatchObject({
      status: 'VALID',
      value: {
        workflowId: 'release-review',
        description: 'Updated review',
        createdAt: created.value.createdAt,
      },
    })
  })

  it('repairs a missing definition against the missing-resource ETag', async () => {
    const { app, paths } = createFixture()
    const created = await createWorkflow(app)
    rmSync(paths.workflow('release-review').definitionFile)

    const source = await app.request('/api/workflows/release-review/source')
    expect(source.status).toBe(200)
    expect(source.headers.get('etag')).toBe('"missing"')
    expect(await source.json()).toMatchObject({
      status: 'INVALID',
      source: null,
      diagnostics: [expect.objectContaining({ code: 'WORKFLOW_FILE_MISSING' })],
    })

    const repaired = await putWorkflow(app, created.value, '"missing"')
    expect(repaired.status).toBe(200)
    expect(repaired.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/u)
    expect(await repaired.json()).toMatchObject({ status: 'VALID' })
  })

  it('returns a semantic validation error instead of treating invalid graphs as server failures', async () => {
    const { app } = createFixture()
    const created = await createWorkflow(app)
    const response = await putWorkflow(
      app,
      {
        ...created.value,
        graph: {
          ...created.value.graph,
          startNodeId: null,
          nodes: [
            {
              type: 'agent',
              id: 'prepare',
              name: 'Prepare',
              prompt: 'Prepare the release.',
              harness: { harnessId: 'pi' },
            },
          ],
        },
      },
      created.response.headers.get('etag') ?? '',
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'WORKFLOW_FILE_INVALID' } })
  })

  it('returns the shared not-found envelope for an unknown workflow source', async () => {
    const { app } = createFixture()

    const response = await app.request('/api/workflows/unknown/source')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow was not found' },
    })
  })
})
