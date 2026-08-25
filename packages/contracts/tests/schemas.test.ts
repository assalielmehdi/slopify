import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  AgentTraceEventSchema,
  AgentTraceHeaderSchema,
  ApiErrorSchema,
  CreateRunRequestSchema,
  DeletionReceiptSchema,
  GitConnectionCatalogResponseSchema,
  GitRepositoryCatalogResponseSchema,
  HarnessCatalogResponseSchema,
  HarnessIdSchema,
  HealthResponseSchema,
  NodeIdSchema,
  OutcomeNameSchema,
  RepositoryCatalogResponseSchema,
  RunEventSchema,
  RunIdSchema,
  RunPaginationQuerySchema,
  SettingsSchema,
  ThemePreferenceSchema,
  UndoDeletionResponseSchema,
  UpdateSettingsRequestSchema,
  WorkflowIdSchema,
  type HarnessId,
  type RunId,
  type WorkflowId,
} from '../src/index.js'

const eventBase = {
  runId: 'run-01',
  sequence: 1,
  timestamp: '2026-08-18T20:00:00Z',
}

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
              id: 'openai-codex/gpt-5.4',
              name: 'openai-codex/gpt-5.4',
              thinkingLevels: ['off', 'low', 'medium', 'high'],
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
  it('keeps repository deletion receipts closed', () => {
    const receipt = {
      deletionId: 'deletion-01',
      subject: { type: 'REPOSITORY', id: 'repository-01' },
      deletedAt: '2026-08-22T10:00:00Z',
      undoExpiresAt: '2026-08-22T10:00:10Z',
    }

    expect(DeletionReceiptSchema.parse(receipt)).toEqual(receipt)
    expect(UndoDeletionResponseSchema.parse({ ...receipt, state: 'UNDONE' })).toEqual({
      ...receipt,
      state: 'UNDONE',
    })
    expect(
      DeletionReceiptSchema.safeParse({
        ...receipt,
        subject: { type: 'UNKNOWN', id: 'unknown-01' },
      }).success,
    ).toBe(false)
  })

  it('accepts workflow deletion receipts', () => {
    const receipt = {
      deletionId: 'deletion-workflow-01',
      subject: { type: 'WORKFLOW', id: 'workflow-01' },
      deletedAt: '2026-08-25T10:00:00Z',
      undoExpiresAt: '2026-08-25T10:00:10Z',
    }

    expect(DeletionReceiptSchema.parse(receipt)).toEqual(receipt)
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
    expect(
      HealthResponseSchema.safeParse({ status: 'ok', databasePath: '/private/state.sqlite' })
        .success,
    ).toBe(false)
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
        statuses: ['FAILED', 'CANCELLED'],
        durationMinMs: '1000',
        durationMaxMs: '5000',
      }),
    ).toMatchObject({
      page: 2,
      pageSize: 20,
      statuses: ['FAILED', 'CANCELLED'],
      durationMinMs: 1000,
      durationMaxMs: 5000,
    })
    expect(RunPaginationQuerySchema.safeParse({ statuses: ['FAILED', 'FAILED'] }).success).toBe(
      false,
    )
  })
})

describe('run events', () => {
  const validEvents = [
    { ...eventBase, type: 'RUN_STARTED', data: { workflowId: 'workflow-01' } },
    { ...eventBase, type: 'RUN_STATUS_CHANGED', data: { from: 'PENDING', to: 'RUNNING' } },
    { ...eventBase, type: 'NODE_STARTED', nodeId: 'agent-01', data: {} },
    {
      ...eventBase,
      type: 'NODE_COMPLETED',
      nodeId: 'agent-01',
      data: { outcome: 'completed', durationMs: 25 },
    },
    {
      ...eventBase,
      type: 'NODE_CANCELLED',
      nodeId: 'agent-01',
      data: { reason: 'Cancelled by the user', durationMs: 25 },
    },
    {
      ...eventBase,
      type: 'NODE_FAILED',
      nodeId: 'agent-01',
      data: { code: 'PROCESS_FAILED', message: 'Agent failed', durationMs: 25 },
    },
    { ...eventBase, type: 'RUN_CANCEL_REQUESTED', data: { reason: 'operator request' } },
    { ...eventBase, type: 'RUN_COMPLETED', data: { status: 'SUCCEEDED', durationMs: 100 } },
  ]

  it.each(validEvents)('parses the $type event contract', (event) => {
    expect(RunEventSchema.parse(event)).toEqual(event)
  })

  it('keeps node event data strict', () => {
    expect(
      RunEventSchema.safeParse({
        ...eventBase,
        type: 'NODE_COMPLETED',
        nodeId: 'agent-01',
        data: { outcome: 'completed', durationMs: 25, unexpected: true },
      }).success,
    ).toBe(false)
  })
})

describe('agent traces', () => {
  const header = {
    version: 3,
    runId: 'run-01',
    nodeExecutionId: 'node-execution-01',
    attemptId: 'attempt-01',
    nodeId: 'agent-01',
    createdAt: '2026-08-23T10:00:00.000Z',
    configuration: {
      harnessId: 'pi',
      harnessVersion: '0.84.2',
      model: 'openai-codex/gpt-5.4',
      thinkingLevel: 'medium',
      renderedPrompt: 'Inspect the primary workspace.',
      workspaceRoot: '/Users/operator/.slopify/orchestrator/workspaces/run-01',
      primaryRepositoryId: 'slopify',
      repositories: [
        {
          repositoryId: 'slopify',
          name: 'Slopify',
          provider: 'GITHUB',
          fullName: 'operator/slopify',
          workspacePath: '/Users/operator/.slopify/orchestrator/workspaces/run-01/slopify',
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

  it('continues to parse immutable version 1 worktree traces', () => {
    expect(
      AgentTraceHeaderSchema.parse({
        ...header,
        version: 1,
        configuration: {
          ...header.configuration,
          repositories: [
            {
              repositoryId: 'repository-api',
              name: 'API',
              worktreePath: '/worktrees/run-01/repository-api',
              baseSha: 'a'.repeat(40),
              sourceBranch: 'main',
            },
          ],
        },
      }).version,
    ).toBe(1)
  })

  it('normalizes persisted version 2 project keys to repository vocabulary', () => {
    const parsed = AgentTraceHeaderSchema.parse({
      ...header,
      version: 2,
      configuration: {
        ...header.configuration,
        primaryRepositoryId: undefined,
        repositories: undefined,
        primaryProjectId: 'slopify',
        projects: [
          {
            ...header.configuration.repositories[0],
            repositoryId: undefined,
            projectId: 'slopify',
          },
        ],
      },
    })

    expect(parsed.configuration.primaryRepositoryId).toBe('slopify')
    expect(parsed.configuration.repositories[0]?.repositoryId).toBe('slopify')
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
