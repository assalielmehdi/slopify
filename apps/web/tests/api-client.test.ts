import { describe, expect, it, vi } from 'vitest'

import {
  AgentTraceSchema,
  DeletionReceiptSchema,
  HarnessCatalogResponseSchema,
  RepositorySchema,
  SettingsSchema,
  UndoDeletionResponseSchema,
} from '@slopify/contracts'
import { workflowToWorkflowFile, type Workflow } from '@slopify/workflow-model'

import { ApiClientError, createApiClient } from '../lib/api-client'
import { createAgentWorkflowFixture } from './fixtures/workflow'

const workflowEntry = (workflow: Workflow, revision = 'a'.repeat(64)) => ({
  status: 'VALID' as const,
  workflowId: workflow.workflowId,
  value: workflowToWorkflowFile(workflow),
  revision,
  runnable: workflow.nodes.length > 0,
  readiness: [],
})

describe('API client', () => {
  it('loads the host-discovered harness catalog', async () => {
    const response = HarnessCatalogResponseSchema.parse({
      harnesses: [
        {
          harnessId: 'pi',
          name: 'Pi',
          description: 'Runs the locally installed Pi coding agent.',
          availability: 'AVAILABLE',
          executablePath: '/opt/homebrew/bin/pi',
          version: '0.84.2',
          installHref: 'https://pi.dev/',
          installLabel: 'Install Pi',
          models: [],
        },
      ],
    })
    const fetchImplementation = vi.fn(async () => Response.json(response))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.listHarnesses()).resolves.toEqual(response.harnesses)
    expect(fetchImplementation).toHaveBeenCalledWith('/api/harnesses', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
  })

  it('loads a typed agent trace for one captured node execution', async () => {
    const trace = AgentTraceSchema.parse({
      header: {
        version: 2,
        runId: 'run-01',
        nodeExecutionId: 'node-execution-01',
        attemptId: 'attempt-01',
        nodeId: 'identify-agent',
        createdAt: '2026-08-22T10:00:00.000Z',
        configuration: {
          harnessId: 'pi',
          harnessVersion: '0.84.2',
          model: 'test/model',
          thinkingLevel: 'medium',
          renderedPrompt: 'Inspect the repository.',
          workspaceRoot: '/workspaces/run-01',
          primaryRepositoryId: 'repository-api',
          repositories: [
            {
              repositoryId: 'repository-api',
              name: 'API',
              provider: 'GITHUB',
              fullName: 'operator/api',
              workspacePath: '/workspaces/run-01/repository-api',
              branchName: 'slopify/run-01',
              baseSha: 'a'.repeat(40),
              defaultBranch: 'main',
            },
          ],
          timeoutSeconds: 600,
        },
      },
      events: [],
      complete: false,
    })
    const fetchImplementation = vi.fn(async () => Response.json(trace))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(
      client.getAgentTrace('run-01', 'node-execution-01', 'attempt-01'),
    ).resolves.toEqual(trace)
    expect(fetchImplementation).toHaveBeenCalledWith(
      '/api/runs/run-01/node-executions/node-execution-01/trace?attemptId=attempt-01',
      { headers: { accept: 'application/json' }, method: 'GET' },
    )
  })

  it('loads typed health data from the same-origin Hono boundary', async () => {
    const fetchImplementation = vi.fn(async () => Response.json({ status: 'ok' }, { status: 200 }))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.getHealth()).resolves.toEqual({ status: 'ok' })
    expect(fetchImplementation).toHaveBeenCalledWith('/api/healthz', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
  })

  it('loads and updates settings with their strong ETag', async () => {
    const system = SettingsSchema.parse({
      schemaVersion: 1,
      appearance: { theme: 'system' },
      git: { connections: [] },
    })
    const dark = SettingsSchema.parse({ ...system, appearance: { theme: 'dark' } })
    const initialEtag = '"missing"'
    const updatedEtag = `"${'a'.repeat(64)}"`
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(system, { headers: { etag: initialEtag } }))
      .mockResolvedValueOnce(Response.json(dark, { headers: { etag: updatedEtag } }))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.getSettings()).resolves.toEqual({ value: system, etag: initialEtag })
    await expect(
      client.updateSettings({ appearance: { theme: 'dark' } }, initialEtag),
    ).resolves.toEqual({ value: dark, etag: updatedEtag })
    expect(fetchImplementation).toHaveBeenNthCalledWith(1, '/api/settings', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(2, '/api/settings', {
      body: JSON.stringify({ appearance: { theme: 'dark' } }),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'if-match': initialEtag,
      },
      method: 'PATCH',
    })
  })

  it('rejects a successful response that violates the shared contract', async () => {
    const client = createApiClient({
      fetch: async () => Response.json({ status: 'unknown' }, { status: 200 }),
    })

    await expect(client.getHealth()).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('surfaces the structured Hono error envelope', async () => {
    const client = createApiClient({
      fetch: async () =>
        Response.json(
          {
            error: {
              code: 'DATABASE_UNAVAILABLE',
              message: 'Local persistence is unavailable',
            },
          },
          { status: 503 },
        ),
    })

    await expect(client.getHealth()).rejects.toEqual(
      new ApiClientError({
        code: 'DATABASE_UNAVAILABLE',
        message: 'Local persistence is unavailable',
        status: 503,
      }),
    )
  })

  it('lists, adds, deletes, and restores remote Git repositories through the same-origin API', async () => {
    const repository = RepositorySchema.parse({
      repositoryId: 'repository-01',
      name: 'slopify',
      provider: 'GITHUB',
      remoteId: '123',
      fullName: 'operator/slopify',
      cloneUrl: 'https://github.com/operator/slopify.git',
      webUrl: 'https://github.com/operator/slopify',
      defaultBranch: 'main',
      availability: 'AVAILABLE',
      createdAt: '2026-08-21T10:00:00Z',
      updatedAt: '2026-08-21T10:00:00Z',
    })
    const deletion = DeletionReceiptSchema.parse({
      deletionId: 'deletion-01',
      subject: { type: 'REPOSITORY', id: 'repository-01' },
      deletedAt: '2026-08-22T10:00:00Z',
      undoExpiresAt: '2026-08-22T10:00:10Z',
    })
    const undone = UndoDeletionResponseSchema.parse({ ...deletion, state: 'UNDONE' })
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ repositories: [repository] }))
      .mockResolvedValueOnce(Response.json(repository, { status: 201 }))
      .mockResolvedValueOnce(Response.json(deletion))
      .mockResolvedValueOnce(Response.json(undone))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.listRepositories()).resolves.toEqual([repository])
    await expect(client.addRepository({ provider: 'GITHUB', remoteId: '123' })).resolves.toEqual(
      repository,
    )
    await expect(client.deleteRepository('repository-01')).resolves.toEqual(deletion)
    await expect(client.undoDeletion('deletion-01')).resolves.toEqual(undone)
    expect(fetchImplementation).toHaveBeenNthCalledWith(1, '/api/repositories', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(2, '/api/repositories', {
      body: JSON.stringify({ provider: 'GITHUB', remoteId: '123' }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(3, '/api/repositories/repository-01', {
      method: 'DELETE',
      headers: { accept: 'application/json' },
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(4, '/api/deletions/deletion-01/undo', {
      method: 'POST',
      headers: { accept: 'application/json' },
    })
  })

  it('configures Git connections and loads their repositories without reading tokens back', async () => {
    const connection = {
      provider: 'GITHUB' as const,
      accountUsername: 'operator',
      connectedAt: '2026-08-24T00:00:00Z',
      updatedAt: '2026-08-24T00:00:00Z',
    }
    const repository = {
      provider: 'GITHUB' as const,
      remoteId: '123',
      name: 'slopify',
      fullName: 'operator/slopify',
      cloneUrl: 'https://github.com/operator/slopify.git',
      webUrl: 'https://github.com/operator/slopify',
      visibility: 'PRIVATE' as const,
      defaultBranch: 'main',
    }
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ connections: [connection] }))
      .mockResolvedValueOnce(Response.json(connection))
      .mockResolvedValueOnce(Response.json({ repositories: [repository] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.listGitConnections()).resolves.toEqual([connection])
    await expect(
      client.configureGitConnection('GITHUB', { token: 'secret-token' }),
    ).resolves.toEqual(connection)
    await expect(client.listGitRepositories('GITHUB')).resolves.toEqual([repository])
    await expect(client.disconnectGitConnection('GITHUB')).resolves.toBeUndefined()

    expect(fetchImplementation).toHaveBeenNthCalledWith(2, '/api/git/connections/GITHUB', {
      body: JSON.stringify({ token: 'secret-token' }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'PUT',
    })
  })

  it('loads, validates, and deletes workflows through the same-origin API', async () => {
    const workflow = createAgentWorkflowFixture({
      createdAt: '2026-08-18T12:00:00Z',
      modelId: 'test-model',
      thinkingLevel: 'high',
    })
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          workflows: [workflowEntry(workflow)],
        }),
      )
      .mockResolvedValueOnce(
        Response.json(workflowEntry(workflow), { headers: { etag: `"${'a'.repeat(64)}"` } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          deletionId: 'deletion-workflow-01',
          subject: { type: 'WORKFLOW', id: workflow.workflowId },
          deletedAt: '2026-08-25T10:00:00Z',
          undoExpiresAt: '2026-08-25T10:00:10Z',
        }),
      )
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.listWorkflows()).resolves.toEqual([workflow])
    await expect(client.getWorkflow(workflow.workflowId)).resolves.toEqual(workflow)
    await expect(client.deleteWorkflow(workflow.workflowId)).resolves.toMatchObject({
      subject: { type: 'WORKFLOW', id: workflow.workflowId },
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(1, '/api/workflows', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(2, '/api/workflows/default-workflow', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(3, '/api/workflows/default-workflow', {
      headers: { accept: 'application/json' },
      method: 'DELETE',
    })
  })

  it('creates a workflow from editable fields and parses the canonical response', async () => {
    const workflow = createAgentWorkflowFixture({
      createdAt: '2026-08-24T14:00:00.000Z',
      modelId: 'test-model',
      thinkingLevel: 'high',
    })
    const input = {
      workflowId: 'release-workflow',
      name: 'release-workflow',
      description: 'Prepare and review a release.',
    } as const
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(workflowEntry(workflow), { headers: { etag: `"${'a'.repeat(64)}"` } }),
      )
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.createWorkflow(input)).resolves.toEqual(workflow)
    expect(fetchImplementation).toHaveBeenCalledWith('/api/workflows', {
      body: JSON.stringify({
        workflowId: 'release-workflow',
        name: 'release-workflow',
        description: 'Prepare and review a release.',
      }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    })
  })

  it('updates a full workflow and parses the canonical response', async () => {
    const workflow = createAgentWorkflowFixture({
      createdAt: '2026-08-18T12:00:00Z',
      modelId: 'gpt-5.5',
      thinkingLevel: 'high',
    })
    const canonical = { ...workflow, updatedAt: '2026-08-22T12:00:00.000Z' }
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ workflows: [workflowEntry(workflow)] }))
      .mockResolvedValueOnce(
        Response.json(workflowEntry(canonical, 'b'.repeat(64)), {
          headers: { etag: `"${'b'.repeat(64)}"` },
        }),
      )
    const client = createApiClient({ fetch: fetchImplementation })

    await client.listWorkflows()
    await expect(client.updateWorkflow(workflow.workflowId, workflow)).resolves.toEqual(canonical)
    expect(fetchImplementation).toHaveBeenNthCalledWith(2, '/api/workflows/default-workflow', {
      body: JSON.stringify(workflowToWorkflowFile(workflow)),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'if-match': `"${'a'.repeat(64)}"`,
      },
      method: 'PUT',
    })
  })

  it('rejects malformed workflow catalog data at the browser boundary', async () => {
    const client = createApiClient({
      fetch: async () => Response.json({ workflows: [{ workflowId: 'missing-fields' }] }),
    })

    await expect(client.listWorkflows()).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('starts a run with generic variables', async () => {
    const run = {
      runId: 'run-01',
      workflowId: 'default-workflow',
      workflowSnapshot: createAgentWorkflowFixture({
        createdAt: '2026-08-18T12:00:00Z',
        modelId: 'test-model',
        thinkingLevel: 'high',
      }),
      variables: { task: 'Coordinate API and web changes.', attempts: 2 },
      status: 'PENDING',
      transitionCount: 0,
      createdAt: '2026-08-20T10:00:00Z',
      startedAt: null,
      completedAt: null,
    }
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(run, { status: 201 }))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(
      client.startRun({
        workflowId: 'default-workflow',
        variables: { task: 'Coordinate API and web changes.', attempts: 2 },
      }),
    ).resolves.toEqual(run)
    expect(fetchImplementation).toHaveBeenCalledWith('/api/runs', {
      body: JSON.stringify({
        workflowId: 'default-workflow',
        variables: { task: 'Coordinate API and web changes.', attempts: 2 },
      }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    })
  })

  it('loads immutable repository and cloned workspace evidence with run details', async () => {
    const workflow = createAgentWorkflowFixture({
      createdAt: '2026-08-18T12:00:00Z',
      modelId: 'test-model',
      thinkingLevel: 'medium',
    })
    const detail = {
      run: {
        runId: 'run-01',
        workflowId: 'default-workflow',
        workflowSnapshot: workflow,
        variables: {},
        status: 'PENDING',
        transitionCount: 0,
        createdAt: '2026-08-23T12:00:00Z',
        startedAt: null,
        completedAt: null,
      },
      events: [],
      nodeExecutions: [],
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
      repositoryWorkspaces: [
        {
          repositoryId: 'repository-api',
          position: 0,
          status: 'READY',
          workspacePath: '/workspaces/run-01/repository-api',
          branchName: 'slopify/run-01',
          errorMessage: null,
          preparedAt: '2026-08-23T12:00:01Z',
          cleanedAt: null,
          updatedAt: '2026-08-23T12:00:01Z',
        },
      ],
    }
    const fetchImplementation = vi.fn(async () => Response.json(detail))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.getRun('run-01')).resolves.toEqual(detail)
    expect(fetchImplementation).toHaveBeenCalledWith('/api/runs/run-01', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
  })
})
