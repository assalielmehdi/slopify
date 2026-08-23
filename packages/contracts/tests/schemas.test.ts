import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  AgentTraceEventSchema,
  AgentTraceHeaderSchema,
  ApiErrorSchema,
  CreateRunRequestSchema,
  DeletionReceiptSchema,
  HarnessCatalogResponseSchema,
  HarnessIdSchema,
  HealthResponseSchema,
  NodeIdSchema,
  OutcomeNameSchema,
  ProjectCatalogResponseSchema,
  RunEventSchema,
  RunIdSchema,
  RunPaginationQuerySchema,
  UndoDeletionResponseSchema,
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

describe('harness and project catalogs', () => {
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

  it('exposes only current local project records', () => {
    const response = {
      projects: [
        {
          projectId: 'slopify',
          name: 'slopify',
          repositoryPath: '/Users/operator/workspace/slopify',
          availability: 'AVAILABLE',
          createdAt: '2026-08-23T10:00:00.000Z',
          updatedAt: '2026-08-23T10:00:00.000Z',
        },
      ],
    }

    expect(ProjectCatalogResponseSchema.parse(response)).toEqual(response)
  })
})

describe('public API records', () => {
  it('keeps project deletion receipts closed', () => {
    const receipt = {
      deletionId: 'deletion-01',
      subject: { type: 'PROJECT', id: 'project-01' },
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
    version: 1,
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
      renderedPrompt: 'Inspect the primary worktree.',
      workspaceRoot: '/Users/operator/.slopify/orchestrator/worktrees/run-01',
      primaryProjectId: 'slopify',
      projects: [
        {
          projectId: 'slopify',
          name: 'Slopify',
          worktreePath: '/Users/operator/.slopify/orchestrator/worktrees/run-01/slopify',
          baseSha: '0123456789abcdef0123456789abcdef01234567',
          sourceBranch: 'main',
        },
      ],
      timeoutSeconds: 600,
    },
  }

  it('captures only the current harness and worktree configuration', () => {
    expect(AgentTraceHeaderSchema.parse(header)).toEqual(header)
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
