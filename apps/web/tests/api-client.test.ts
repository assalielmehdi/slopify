import { describe, expect, it, vi } from 'vitest'

import { ProjectProfileConfigurationSchema } from '@loop/contracts'
import { createPredefinedV1Revision } from '@loop/workflow-model'

import { ApiClientError, createApiClient } from '../lib/api-client'

describe('API client', () => {
  const profile = ProjectProfileConfigurationSchema.parse({
    profileId: 'local-profile',
    displayName: 'Local profile',
    clickupWorkspaceId: 'workspace-01',
    clickupListId: 'list-01',
    clickupInReviewStatusId: 'in-review',
    repositories: [
      {
        repositoryId: 'api',
        displayName: 'API',
        purpose: 'Backend',
        repositoryPath: '/workspace/api',
        gitlabProject: 'group/api',
        remote: 'origin',
        targetBranch: 'main',
        worktreeParent: '/workspace/.worktrees',
        branchTemplate: 'ai/{task}-{run}',
        executableChecks: [{ executable: 'node', arguments: ['--version'] }],
        verificationCommands: [{ executable: 'pnpm', arguments: ['test'] }],
        mergeRequestLabels: ['backend'],
      },
    ],
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

  it('loads and validates the workflow catalog and exact revision', async () => {
    const revision = createPredefinedV1Revision({
      revisionId: 'revision-01',
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
          workflows: [
            {
              workflowId: revision.workflowId,
              name: revision.name,
              latestRevisionId: revision.revisionId,
              revisions: [
                {
                  revisionId: revision.revisionId,
                  parentRevisionId: null,
                  createdAt: revision.createdAt,
                },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json(revision))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.listWorkflows()).resolves.toHaveLength(1)
    await expect(
      client.getWorkflowRevision(revision.workflowId, revision.revisionId),
    ).resolves.toEqual(revision)
    expect(fetchImplementation).toHaveBeenNthCalledWith(1, '/api/workflows', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      '/api/workflows/delivery-workflow/revisions/revision-01',
      { headers: { accept: 'application/json' }, method: 'GET' },
    )
  })

  it('rejects malformed workflow catalog data at the browser boundary', async () => {
    const client = createApiClient({
      fetch: async () => Response.json({ workflows: [{ workflowId: 'missing-fields' }] }),
    })

    await expect(client.listWorkflows()).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('loads the typed profile catalog, connector status, and repository readiness', async () => {
    const readiness = {
      profileId: profile.profileId,
      ready: false,
      repositories: [
        {
          repositoryId: 'api',
          ready: false,
          findings: [
            {
              category: 'git',
              code: 'GIT_REMOTE_MISMATCH',
              message: 'Git remote does not match the configured project',
            },
          ],
        },
      ],
    }
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ profiles: [profile], runtime: { mode: 'container', root: '/workspace' } }),
      )
      .mockResolvedValueOnce(Response.json({ clickup: false, gitlab: true, modelProvider: false }))
      .mockResolvedValueOnce(Response.json(readiness))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.listProjectProfiles()).resolves.toMatchObject({
      profiles: [profile],
      runtime: { mode: 'container', root: '/workspace' },
    })
    await expect(client.getConnectorStatus()).resolves.toEqual({
      clickup: false,
      gitlab: true,
      modelProvider: false,
    })
    await expect(client.getProjectProfileReadiness(profile.profileId)).resolves.toEqual(readiness)
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      3,
      '/api/project-profiles/local-profile/readiness',
      {
        headers: { accept: 'application/json' },
        method: 'GET',
      },
    )
  })

  it('creates and updates profiles through JSON requests and trusts only validated responses', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(profile, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ ...profile, displayName: 'Edited profile' }))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.createProjectProfile(profile)).resolves.toEqual(profile)
    await expect(
      client.updateProjectProfile({ ...profile, displayName: 'Edited profile' }),
    ).resolves.toMatchObject({ displayName: 'Edited profile' })
    expect(fetchImplementation).toHaveBeenNthCalledWith(1, '/api/project-profiles', {
      body: JSON.stringify(profile),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(fetchImplementation).toHaveBeenNthCalledWith(2, '/api/project-profiles/local-profile', {
      body: JSON.stringify({ ...profile, displayName: 'Edited profile' }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'PUT',
    })
  })
})
