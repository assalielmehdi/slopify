import { describe, expect, it, vi } from 'vitest'

import {
  AgentTraceSchema,
  DeletionReceiptSchema,
  ProjectSchema,
  UndoDeletionResponseSchema,
} from '@slopify/contracts'
import { createPredefinedV1Workflow } from '@slopify/workflow-model'

import { ApiClientError, createApiClient } from '../lib/api-client'

describe('API client', () => {
  it('loads a typed agent trace for one captured node execution', async () => {
    const trace = AgentTraceSchema.parse({
      header: {
        version: 1,
        runId: 'run-01',
        nodeExecutionId: 'node-execution-01',
        attemptId: 'attempt-01',
        nodeId: 'identify-agent',
        createdAt: '2026-08-22T10:00:00.000Z',
        configuration: {
          connectionId: 'provider-default',
          provider: 'openrouter',
          model: 'test/model',
          thinkingLevel: 'medium',
          renderedPrompt: 'Inspect the repository.',
          permissionProfile: 'workspace-write',
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

  it('loads the API-owned connection catalog with current connection state', async () => {
    const catalogEntry = {
      type: 'gitlab',
      category: 'connector',
      name: 'GitLab',
      icon: 'gitlab',
      eyebrow: 'Source control',
      summary: 'Read repositories and manage delivery through GitLab.',
      description: 'Connect GitLab to manage delivery.',
      setup: ['Create a personal access token.'],
      access: 'Uses the permissions available to your GitLab user.',
      credentialLabel: 'Personal access token',
      credentialDescription: 'Validated before storage.',
      replacementLabel: 'New personal access token',
      resourceHref: 'https://gitlab.com/-/user_settings/personal_access_tokens',
      resourceLabel: 'Create a personal access token',
    }
    const fetchImplementation = vi.fn(async () =>
      Response.json({ catalog: [catalogEntry], connections: [] }),
    )
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.listConnections?.()).resolves.toEqual({
      catalog: [catalogEntry],
      connections: [],
    })
    expect(fetchImplementation).toHaveBeenCalledWith('/api/connections', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
  })

  it('lists, adds, deletes, and restores local Git projects through the same-origin API', async () => {
    const project = ProjectSchema.parse({
      projectId: 'project-01',
      name: 'slopify',
      repositoryPath: '/workspace/slopify',
      availability: 'AVAILABLE',
      createdAt: '2026-08-21T10:00:00Z',
      updatedAt: '2026-08-21T10:00:00Z',
    })
    const deletion = DeletionReceiptSchema.parse({
      deletionId: 'deletion-01',
      subject: { type: 'PROJECT', id: 'project-01' },
      deletedAt: '2026-08-22T10:00:00Z',
      undoExpiresAt: '2026-08-22T10:00:10Z',
    })
    const undone = UndoDeletionResponseSchema.parse({ ...deletion, state: 'UNDONE' })
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ projects: [project] }))
      .mockResolvedValueOnce(Response.json(project, { status: 201 }))
      .mockResolvedValueOnce(Response.json(deletion))
      .mockResolvedValueOnce(Response.json(undone))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.listProjects?.()).resolves.toEqual([project])
    await expect(client.addProject?.({ repositoryPath: '/workspace/slopify' })).resolves.toEqual(
      project,
    )
    await expect(client.deleteProject?.('project-01')).resolves.toEqual(deletion)
    await expect(client.undoDeletion?.('deletion-01')).resolves.toEqual(undone)
    expect(fetchImplementation).toHaveBeenNthCalledWith(1, '/api/projects', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(2, '/api/projects', {
      body: JSON.stringify({ repositoryPath: '/workspace/slopify' }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(3, '/api/projects/project-01', {
      method: 'DELETE',
      headers: { accept: 'application/json' },
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(4, '/api/deletions/deletion-01/undo', {
      method: 'POST',
      headers: { accept: 'application/json' },
    })
  })

  it('loads and validates the workflow catalog and current workflow', async () => {
    const workflow = createPredefinedV1Workflow({
      createdAt: '2026-08-18T12:00:00Z',
      agentDefaults: {
        provider: 'test-provider',
        model: 'test-model',
        thinkingLevel: 'high',
      },
    })
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          workflows: [workflow],
        }),
      )
      .mockResolvedValueOnce(Response.json(workflow))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.listWorkflows()).resolves.toEqual([workflow])
    await expect(client.getWorkflow(workflow.workflowId)).resolves.toEqual(workflow)
    expect(fetchImplementation).toHaveBeenNthCalledWith(1, '/api/workflows', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(2, '/api/workflows/delivery-workflow', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
  })

  it('rejects malformed workflow catalog data at the browser boundary', async () => {
    const client = createApiClient({
      fetch: async () => Response.json({ workflows: [{ workflowId: 'missing-fields' }] }),
    })

    await expect(client.listWorkflows()).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('loads connector status without exposing removed delivery profile APIs', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ clickup: false, gitlab: true, modelProvider: false }))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.getConnectorStatus()).resolves.toEqual({
      clickup: false,
      gitlab: true,
      modelProvider: false,
    })
    expect('listProjectProfiles' in client).toBe(false)
    expect('getProjectProfileReadiness' in client).toBe(false)
    expect('resolveClickUpTask' in client).toBe(false)
  })

  it('starts a run with generic variables', async () => {
    const run = {
      runId: 'run-01',
      workflowId: 'delivery-workflow',
      workflowSnapshot: createPredefinedV1Workflow({
        createdAt: '2026-08-18T12:00:00Z',
        agentDefaults: {
          provider: 'test-provider',
          model: 'test-model',
          thinkingLevel: 'high',
        },
      }),
      variables: { task: 'Coordinate API and web delivery.', attempts: 2 },
      missingVariables: [],
      status: 'PENDING',
      currentNodeId: null,
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
        workflowId: 'delivery-workflow',
        variables: { task: 'Coordinate API and web delivery.', attempts: 2 },
      }),
    ).resolves.toEqual(run)
    expect(fetchImplementation).toHaveBeenCalledWith('/api/runs', {
      body: JSON.stringify({
        workflowId: 'delivery-workflow',
        variables: { task: 'Coordinate API and web delivery.', attempts: 2 },
      }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    })
  })

  it('preserves the active run identity from a start conflict', async () => {
    const client = createApiClient({
      fetch: async () =>
        Response.json(
          {
            error: {
              code: 'RUN_ACTIVE',
              message: 'Another run is already active',
              details: { activeRunId: 'run-active-01' },
            },
          },
          { status: 409 },
        ),
    })

    await expect(
      client.startRun({
        workflowId: 'delivery-workflow',
        variables: {},
      }),
    ).rejects.toEqual(
      new ApiClientError({
        code: 'RUN_ACTIVE',
        message: 'Another run is already active',
        status: 409,
        details: { activeRunId: 'run-active-01' },
      }),
    )
  })
})
