import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  ApiErrorSchema,
  ArtifactTypeSchema,
  EvidenceSchema,
  FinalizeClickUpInputSchema,
  HealthResponseSchema,
  NodeIdSchema,
  OutcomeNameSchema,
  RepositoryReferenceSchema,
  RunEventSchema,
  RunIdSchema,
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
        value: 'pnpm --filter @loop/contracts test',
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
      data: {
        workflowId: 'delivery-workflow',
        revisionId: 'revision-01',
        profileId: 'local-profile',
        taskReference: 'CU-123',
      },
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
