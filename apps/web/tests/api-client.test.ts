import { describe, expect, it, vi } from 'vitest'

import {
  AgentTraceSchema,
  DeletionReceiptSchema,
  HarnessCatalogResponseSchema,
  ProjectSchema,
  UndoDeletionResponseSchema,
} from '@slopify/contracts'

import { ApiClientError, createApiClient } from '../lib/api-client'
import { createAgentWorkflowFixture } from './fixtures/workflow'

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
        version: 1,
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
          workspaceRoot: '/worktrees/run-01/project-api',
          primaryProjectId: 'project-api',
          projects: [
            {
              projectId: 'project-api',
              name: 'API',
              worktreePath: '/worktrees/run-01/project-api',
              baseSha: 'a'.repeat(40),
              sourceBranch: 'main',
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
    const workflow = createAgentWorkflowFixture({
      createdAt: '2026-08-18T12:00:00Z',
      modelId: 'test-model',
      thinkingLevel: 'high',
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
    expect(fetchImplementation).toHaveBeenNthCalledWith(2, '/api/workflows/default-workflow', {
      headers: { accept: 'application/json' },
      method: 'GET',
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
      .mockResolvedValueOnce(Response.json(canonical))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.updateWorkflow(workflow.workflowId, workflow)).resolves.toEqual(canonical)
    expect(fetchImplementation).toHaveBeenCalledWith('/api/workflows/default-workflow', {
      body: JSON.stringify(workflow),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
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

  it('loads immutable project and worktree evidence with run details', async () => {
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
      projects: [
        {
          projectId: 'project-api',
          position: 0,
          name: 'API',
          repositoryPath: '/repositories/api',
          baseSha: 'a'.repeat(40),
          sourceBranch: 'main',
          isPrimary: true,
        },
      ],
      projectWorktrees: [
        {
          projectId: 'project-api',
          position: 0,
          status: 'READY',
          worktreePath: '/worktrees/run-01/project-api',
          errorMessage: null,
          preparedAt: '2026-08-23T12:00:01Z',
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
