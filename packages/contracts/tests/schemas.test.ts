import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  ApiErrorSchema,
  ArtifactTypeSchema,
  CreateRunRequestSchema,
  DeletionReceiptSchema,
  UndoDeletionResponseSchema,
  EvidenceSchema,
  FinalizeClickUpInputSchema,
  HealthResponseSchema,
  NodeIdSchema,
  OutcomeNameSchema,
  ProjectProfileCatalogResponseSchema,
  ProjectProfileConfigurationSchema,
  RepositoryReferenceSchema,
  RunEventSchema,
  RunIdSchema,
  RunPaginationQuerySchema,
  RunStatusSchema,
  WorkflowIdSchema,
  type RunId,
  type WorkflowId,
} from '../src/index.js'

const eventBase = {
  runId: 'run-01',
  sequence: 1,
  timestamp: '2026-08-18T20:00:00Z',
}

describe('branded identifiers', () => {
  it('accepts stable opaque identifiers while keeping brands distinct', () => {
    const workflowId = WorkflowIdSchema.parse('delivery-workflow')
    const runId = RunIdSchema.parse('019c-run.01')

    expect(workflowId).toBe('delivery-workflow')
    expect(runId).toBe('019c-run.01')
    expectTypeOf<WorkflowId>().not.toEqualTypeOf<RunId>()
  })

  it.each(['', ' ', 'contains spaces', '../escape', 'UPPERCASE'])(
    'rejects malformed opaque identifier %j',
    (value) => {
      expect(WorkflowIdSchema.safeParse(value).success).toBe(false)
    },
  )

  it.each(['plan-node', 'review-2'])('accepts kebab-case node and outcome name %s', (value) => {
    expect(NodeIdSchema.parse(value)).toBe(value)
    expect(OutcomeNameSchema.parse(value)).toBe(value)
  })
})

describe('public API records', () => {
  it('keeps deletion receipts generic while subjects remain explicit', () => {
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
        subject: { type: 'CONNECTION', id: 'connection-01' },
      }).success,
    ).toBe(false)
  })

  it('uses one strict API error envelope', () => {
    expect(
      ApiErrorSchema.parse({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid workflow document',
          details: { field: 'nodes.0.id' },
        },
      }),
    ).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid workflow document',
        details: { field: 'nodes.0.id' },
      },
    })

    expect(
      ApiErrorSchema.safeParse({
        error: { code: 'validation-error', message: 'bad' },
        token: 'must-not-be-public',
      }).success,
    ).toBe(false)
  })

  it('keeps the health response minimal and closed', () => {
    expect(HealthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' })
    expect(
      HealthResponseSchema.safeParse({ status: 'ok', databasePath: '/private/state.sqlite' })
        .success,
    ).toBe(false)
  })

  it('validates strict provider-neutral evidence and repository references', () => {
    expect(
      EvidenceSchema.parse({
        kind: 'test',
        value: 'pnpm --filter @slopify/contracts test',
        repositoryId: 'workbench',
      }),
    ).toMatchObject({ kind: 'test', repositoryId: 'workbench' })

    expect(
      RepositoryReferenceSchema.parse({
        repositoryId: 'workbench',
        path: '/workspace/workbench',
        access: 'read-only',
      }),
    ).toMatchObject({ repositoryId: 'workbench', access: 'read-only' })

    expect(
      EvidenceSchema.safeParse({ kind: 'note', value: 'ok', apiToken: 'secret' }).success,
    ).toBe(false)
  })

  it('keeps enum values closed and explicit', () => {
    expect(ArtifactTypeSchema.parse('EXECUTION_PLAN')).toBe('EXECUTION_PLAN')
    expect(RunStatusSchema.parse('INTERRUPTED')).toBe('INTERRUPTED')
    expect(ArtifactTypeSchema.safeParse('RAW_LOG').success).toBe(false)
  })

  it('describes the active profile path boundary without runtime secrets', () => {
    expect(
      ProjectProfileCatalogResponseSchema.parse({
        profiles: [],
        runtime: { mode: 'container', root: '/workspace' },
      }),
    ).toEqual({ profiles: [], runtime: { mode: 'container', root: '/workspace' } })

    expect(
      ProjectProfileCatalogResponseSchema.safeParse({
        profiles: [],
        runtime: { mode: 'container', root: '/workspace', hostPath: '/Users/operator' },
      }).success,
    ).toBe(false)
  })

  it('accepts a repository-free profile for workflows that need no source checkout', () => {
    expect(
      ProjectProfileConfigurationSchema.parse({
        profileId: 'default-profile',
        displayName: 'Default profile',
        clickupWorkspaceId: 'not-required',
        clickupListId: 'not-required',
        clickupInReviewStatusId: 'not-required',
        repositories: [],
      }),
    ).toMatchObject({ profileId: 'default-profile', repositories: [] })
  })

  it('accepts workflow variables and rejects removed task and profile inputs', () => {
    expect(
      CreateRunRequestSchema.parse({
        workflowId: 'delivery-workflow',
        variables: {
          objective: 'Coordinate the API and web changes.',
          attempts: 2,
          flags: ['focused'],
        },
        confirmMissingVariables: true,
      }),
    ).toEqual({
      workflowId: 'delivery-workflow',
      variables: {
        objective: 'Coordinate the API and web changes.',
        attempts: 2,
        flags: ['focused'],
      },
      confirmMissingVariables: true,
    })

    expect(
      CreateRunRequestSchema.safeParse({
        taskReference: 'CU-123',
        workflowId: 'delivery-workflow',
        profileId: 'local-profile',
      }).success,
    ).toBe(false)
  })

  it('validates run filters together with pagination', () => {
    expect(
      RunPaginationQuerySchema.parse({
        page: '2',
        pageSize: '20',
        runId: 'run-api',
        statuses: ['FAILED', 'CANCELLED'],
        startedFrom: '2026-08-20T00:00:00.000Z',
        startedTo: '2026-08-22T23:59:59.999Z',
        durationMinMs: '1000',
        durationMaxMs: '5000',
      }),
    ).toEqual({
      page: 2,
      pageSize: 20,
      runId: 'run-api',
      statuses: ['FAILED', 'CANCELLED'],
      startedFrom: '2026-08-20T00:00:00.000Z',
      startedTo: '2026-08-22T23:59:59.999Z',
      durationMinMs: 1000,
      durationMaxMs: 5000,
    })

    expect(
      RunPaginationQuerySchema.safeParse({
        startedFrom: '2026-08-23T00:00:00.000Z',
        startedTo: '2026-08-22T00:00:00.000Z',
      }).success,
    ).toBe(false)
    expect(
      RunPaginationQuerySchema.safeParse({ durationMinMs: 5000, durationMaxMs: 1000 }).success,
    ).toBe(false)
    expect(RunPaginationQuerySchema.safeParse({ statuses: ['FAILED', 'FAILED'] }).success).toBe(
      false,
    )
  })

  it.each([
    { sourceBranch: 'ai/run\n## injected' },
    { targetBranch: 'main?unexpected=true' },
    { url: 'javascript:alert(1)' },
  ])('rejects unsafe merge request identity fields at finalization', (override) => {
    const mergeRequest = {
      repositoryId: 'api',
      project: 'group/api',
      iid: 17,
      url: 'https://gitlab.example/group/api/-/merge_requests/17',
      state: 'opened',
      sourceBranch: 'ai/run-01',
      targetBranch: 'main',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      ...override,
    }

    expect(
      FinalizeClickUpInputSchema.safeParse({
        runId: 'run-01',
        taskId: '86abc123',
        mergeRequests: [mergeRequest],
      }).success,
    ).toBe(false)
  })
})

describe('run events', () => {
  const validEvents = [
    {
      ...eventBase,
      type: 'RUN_STARTED',
      data: { workflowId: 'delivery-workflow' },
    },
    { ...eventBase, type: 'RUN_STATUS_CHANGED', data: { from: 'PENDING', to: 'RUNNING' } },
    { ...eventBase, type: 'NODE_STARTED', nodeId: 'load-task', data: {} },
    {
      ...eventBase,
      type: 'NODE_OUTPUT',
      nodeId: 'verify',
      data: { channel: 'stdout', content: 'checks passed', repositoryId: 'workbench' },
    },
    {
      ...eventBase,
      type: 'NODE_COMPLETED',
      nodeId: 'verify',
      data: { outcome: 'passed', durationMs: 25, artifactIds: [] },
    },
    {
      ...eventBase,
      type: 'NODE_FAILED',
      nodeId: 'verify',
      data: { code: 'PROCESS_FAILED', message: 'check failed', durationMs: 25 },
    },
    {
      ...eventBase,
      type: 'EDGE_SELECTED',
      nodeId: 'verify',
      data: { outcome: 'passed', targetNodeId: 'requirements-review' },
    },
    {
      ...eventBase,
      type: 'ARTIFACT_RECORDED',
      nodeId: 'plan',
      data: { artifactId: 'artifact-01', artifactType: 'EXECUTION_PLAN' },
    },
    { ...eventBase, type: 'RUN_CANCEL_REQUESTED', data: { reason: 'operator request' } },
    { ...eventBase, type: 'RUN_COMPLETED', data: { status: 'SUCCEEDED', durationMs: 100 } },
  ]

  it.each(validEvents)('parses the $type event contract', (event) => {
    expect(RunEventSchema.parse(event)).toEqual(event)
  })

  it.each([
    { ...validEvents[0], sequence: 0 },
    { ...validEvents[0], timestamp: 'not-a-date' },
    { ...eventBase, type: 'NODE_STARTED', data: {} },
    { ...eventBase, type: 'UNKNOWN_EVENT', data: {} },
    { ...eventBase, type: 'RUN_CANCEL_REQUESTED', data: { apiToken: 'secret' } },
  ])('rejects a malformed or non-contract event', (event) => {
    expect(RunEventSchema.safeParse(event).success).toBe(false)
  })
})
