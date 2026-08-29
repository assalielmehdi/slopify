import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  AgentTraceEventSchema,
  AgentTraceHeaderSchema,
  ApiErrorSchema,
  CreateRunRequestSchema,
  GitConnectionCatalogResponseSchema,
  GitRepositoryCatalogResponseSchema,
  HarnessCatalogResponseSchema,
  HarnessIdSchema,
  HealthResponseSchema,
  NodeIdSchema,
  OutcomeNameSchema,
  RepositoryCatalogResponseSchema,
  ResourceChangeEventSchema,
  RunIdSchema,
  RunPaginationQuerySchema,
  SettingsSchema,
  ThemePreferenceSchema,
  UpdateSettingsRequestSchema,
  WorkflowIdSchema,
  WorkflowRunOutcomeCatalogResponseSchema,
  type HarnessId,
  type RunId,
  type WorkflowId,
} from '../../src/index.js'

describe('branded identifiers', () => {
  it('keeps workflow, run, and harness identifiers distinct', () => {
    expect(WorkflowIdSchema.parse('workflow-01')).toBe('workflow-01')
    expect(RunIdSchema.parse('019c-run.01')).toBe('019c-run.01')
    expect(HarnessIdSchema.parse('pi')).toBe('pi')
    expectTypeOf<WorkflowId>().not.toEqualTypeOf<RunId>()
    expectTypeOf<HarnessId>().not.toEqualTypeOf<RunId>()
  })

  it.each(['', ' ', 'contains spaces', '../escape', 'UPPERCASE'])(
    'rejects malformed opaque identifier %j',
    (value) => expect(WorkflowIdSchema.safeParse(value).success).toBe(false),
  )

  it.each(['plan-node', 'review-2'])('accepts kebab-case graph identifier %s', (value) => {
    expect(NodeIdSchema.parse(value)).toBe(value)
    expect(OutcomeNameSchema.parse(value)).toBe(value)
  })
})

describe('harness and repository catalogs', () => {
  it('describes host-discovered harnesses without exposing host configuration', () => {
    const catalog = HarnessCatalogResponseSchema.parse({
      harnesses: [
        {
          harnessId: 'pi',
          name: 'Pi',
          description: 'Run workflows with the Pi CLI configured on this machine.',
          availability: 'AVAILABLE',
          executablePath: '/opt/homebrew/bin/pi',
          version: '0.84.2',
          installHref: 'https://pi.dev/',
          installLabel: 'Install Pi',
          models: [
            {
              id: 'test/model',
              name: 'Test model',
              thinkingLevels: ['off', 'low', 'medium', 'high', 'ultra'],
            },
          ],
        },
      ],
    })

    expect(catalog.harnesses[0]).toMatchObject({
      harnessId: 'pi',
      availability: 'AVAILABLE',
      version: '0.84.2',
    })
    expect(
      HarnessCatalogResponseSchema.safeParse({
        harnesses: [{ ...catalog.harnesses[0], unexpected: true }],
      }).success,
    ).toBe(false)
  })

  it('keeps unavailable harnesses actionable', () => {
    expect(
      HarnessCatalogResponseSchema.parse({
        harnesses: [
          {
            harnessId: 'pi',
            name: 'Pi',
            description: 'Run workflows with the Pi CLI configured on this machine.',
            availability: 'UNAVAILABLE',
            unavailableReason: 'Pi was not found in PATH.',
            installHref: 'https://pi.dev/',
            installLabel: 'Install Pi',
            models: [],
          },
        ],
      }).harnesses[0],
    ).toMatchObject({ availability: 'UNAVAILABLE', models: [] })
  })

  it('exposes connected Git providers without their credentials', () => {
    const response = {
      connections: [
        {
          provider: 'GITHUB',
          accountUsername: 'operator',
          connectedAt: '2026-08-23T10:00:00.000Z',
          updatedAt: '2026-08-23T10:00:00.000Z',
        },
      ],
    }

    expect(GitConnectionCatalogResponseSchema.parse(response)).toEqual(response)
    expect(
      GitConnectionCatalogResponseSchema.safeParse({
        connections: [{ ...response.connections[0], token: 'secret' }],
      }).success,
    ).toBe(false)
  })

  it('describes repositories selectable from a connected provider', () => {
    const response = {
      repositories: [
        {
          provider: 'GITLAB',
          remoteId: '42',
          name: 'api',
          fullName: 'platform/api',
          cloneUrl: 'https://gitlab.com/platform/api.git',
          webUrl: 'https://gitlab.com/platform/api',
          visibility: 'PRIVATE',
          defaultBranch: 'main',
        },
      ],
    }

    expect(GitRepositoryCatalogResponseSchema.parse(response)).toEqual(response)
  })

  it('exposes only current remote repository records', () => {
    const response = {
      repositories: [
        {
          repositoryId: 'slopify',
          name: 'slopify',
          provider: 'GITHUB',
          remoteId: '123',
          fullName: 'operator/slopify',
          cloneUrl: 'https://github.com/operator/slopify.git',
          webUrl: 'https://github.com/operator/slopify',
          defaultBranch: 'main',
          availability: 'AVAILABLE',
          createdAt: '2026-08-23T10:00:00.000Z',
          updatedAt: '2026-08-23T10:00:00.000Z',
        },
      ],
    }

    expect(RepositoryCatalogResponseSchema.parse(response)).toEqual(response)
  })
})

describe('settings', () => {
  const settings = {
    schemaVersion: 1,
    appearance: { theme: 'system' },
    git: {
      connections: [
        {
          provider: 'GITHUB',
          accountUsername: 'operator',
          connectedAt: '2026-08-25T10:00:00.000Z',
          updatedAt: '2026-08-25T10:00:00.000Z',
        },
      ],
    },
  }

  it('limits the appearance theme to light, dark, or system', () => {
    expect(ThemePreferenceSchema.options).toEqual(['light', 'dark', 'system'])
    expect(SettingsSchema.parse(settings)).toEqual(settings)
    expect(
      SettingsSchema.safeParse({
        ...settings,
        appearance: { theme: 'automatic' },
      }).success,
    ).toBe(false)
  })

  it.each([{ token: 'github_pat_secret' }, { credentialReference: 'credential://github' }])(
    'rejects secret-bearing public Git metadata %j',
    (secretField) => {
      expect(
        SettingsSchema.safeParse({
          ...settings,
          git: {
            connections: [{ ...settings.git.connections[0], ...secretField }],
          },
        }).success,
      ).toBe(false)
    },
  )

  it('allows at most one connection per supported provider', () => {
    expect(
      SettingsSchema.safeParse({
        ...settings,
        git: {
          connections: [settings.git.connections[0], settings.git.connections[0]],
        },
      }).success,
    ).toBe(false)
  })

  it('limits settings updates to the appearance category', () => {
    expect(UpdateSettingsRequestSchema.parse({ appearance: { theme: 'dark' } })).toEqual({
      appearance: { theme: 'dark' },
    })
    expect(
      UpdateSettingsRequestSchema.safeParse({
        appearance: { theme: 'dark' },
        git: { connections: [] },
      }).success,
    ).toBe(false)
  })
})

describe('public API records', () => {
  it('publishes only successful and failed workflow run outcomes', () => {
    const response = {
      outcomes: [
        {
          workflowId: 'release-workflow',
          runId: 'run-01',
          status: 'SUCCEEDED',
          completedAt: '2026-08-25T21:00:00.000Z',
        },
      ],
    }

    expect(WorkflowRunOutcomeCatalogResponseSchema.parse(response)).toEqual(response)
    expect(
      WorkflowRunOutcomeCatalogResponseSchema.safeParse({
        outcomes: [{ ...response.outcomes[0], status: 'CANCELLED' }],
      }).success,
    ).toBe(false)
  })

  it('publishes strict non-secret editable resource events', () => {
    const event = {
      sequence: 1,
      timestamp: '2026-08-25T21:00:00.000Z',
      change: 'CHANGED',
      resource: { type: 'WORKFLOW', workflowId: 'release-workflow' },
      revision: 'a'.repeat(64),
    }

    expect(ResourceChangeEventSchema.parse(event)).toEqual(event)
    expect(
      ResourceChangeEventSchema.parse({
        ...event,
        resource: { type: 'SETTINGS' },
        revision: null,
      }),
    ).toMatchObject({ resource: { type: 'SETTINGS' }, revision: null })
    expect(
      ResourceChangeEventSchema.safeParse({
        ...event,
        path: '/Users/operator/.slopify/workflows/release-workflow/workflow.json',
      }).success,
    ).toBe(false)
    expect(
      ResourceChangeEventSchema.safeParse({
        ...event,
        token: 'github_pat_secret',
      }).success,
    ).toBe(false)
  })

  it('uses strict error and health envelopes', () => {
    expect(
      ApiErrorSchema.parse({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid workflow document',
          details: { field: 'nodes.0.id' },
        },
      }),
    ).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    expect(HealthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' })
  })

  it('accepts workflow variables and rejects unrelated admission input', () => {
    expect(
      CreateRunRequestSchema.parse({
        workflowId: 'workflow-01',
        variables: { objective: 'Coordinate the API and web changes.', attempts: 2 },
      }),
    ).toEqual({
      workflowId: 'workflow-01',
      variables: { objective: 'Coordinate the API and web changes.', attempts: 2 },
    })
    expect(
      CreateRunRequestSchema.safeParse({ workflowId: 'workflow-01', unexpected: true }).success,
    ).toBe(false)
  })

  it('validates run filters together with pagination', () => {
    expect(
      RunPaginationQuerySchema.parse({
        page: '2',
        pageSize: '20',
        workflowIds: ['workflow-01', 'workflow-02'],
        repositoryIds: ['repository-api', 'repository-web'],
        statuses: ['FAILED', 'CANCELLED'],
        durationMinMs: '1000',
        durationMaxMs: '5000',
      }),
    ).toMatchObject({
      page: 2,
      pageSize: 20,
      workflowIds: ['workflow-01', 'workflow-02'],
      repositoryIds: ['repository-api', 'repository-web'],
      statuses: ['FAILED', 'CANCELLED'],
      durationMinMs: 1000,
      durationMaxMs: 5000,
    })
    expect(RunPaginationQuerySchema.safeParse({ statuses: ['FAILED', 'FAILED'] }).success).toBe(
      false,
    )
    expect(
      RunPaginationQuerySchema.safeParse({ workflowIds: ['workflow-01', 'workflow-01'] }).success,
    ).toBe(false)
    expect(
      RunPaginationQuerySchema.safeParse({
        repositoryIds: ['repository-api', 'repository-api'],
      }).success,
    ).toBe(false)
  })
})

describe('agent traces', () => {
  const header = {
    version: 4,
    runId: 'run-01',
    nodeExecutionId: 'node-execution-01',
    attemptId: 'attempt-01',
    nodeId: 'agent-01',
    createdAt: '2026-08-23T10:00:00.000Z',
    configuration: {
      harnessId: 'pi',
      harnessVersion: '0.84.2',
      model: 'test/model',
      thinkingLevel: 'medium',
      renderedPrompt: 'Inspect the primary workspace.',
      artifactsPath: '/Users/operator/.slopify/workflows/release-review/runs/run-01/artifacts',
      workspaceRoot: '/Users/operator/.slopify/workflows/release-review/runs/run-01/workspaces',
      primaryRepositoryId: 'slopify',
      repositories: [
        {
          repositoryId: 'slopify',
          name: 'Slopify',
          provider: 'GITHUB',
          fullName: 'operator/slopify',
          workspacePath:
            '/Users/operator/.slopify/workflows/release-review/runs/run-01/workspaces/slopify',
          branchName: 'slopify/run-01',
          baseSha: '0123456789abcdef0123456789abcdef01234567',
          defaultBranch: 'main',
        },
      ],
      timeoutSeconds: 600,
    },
  }

  it('captures only the current harness and cloned workspace configuration', () => {
    expect(AgentTraceHeaderSchema.parse(header)).toEqual(header)
  })

  it('rejects unsupported trace versions', () => {
    const { artifactsPath: _artifactsPath, ...configuration } = header.configuration
    void _artifactsPath

    expect(
      AgentTraceHeaderSchema.safeParse({ ...header, version: 99, configuration }).success,
    ).toBe(false)
  })

  it('keeps trace headers and event types strict', () => {
    expect(
      AgentTraceHeaderSchema.safeParse({
        ...header,
        configuration: { ...header.configuration, unexpected: true },
      }).success,
    ).toBe(false)
    expect(
      AgentTraceEventSchema.safeParse({
        sequence: 1,
        timestamp: '2026-08-23T10:00:00.000Z',
        type: 'UNKNOWN_EVENT',
        data: {},
      }).success,
    ).toBe(false)
  })
})
