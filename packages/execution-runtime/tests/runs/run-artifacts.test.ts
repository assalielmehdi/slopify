import { describe, expect, it } from 'vitest'

import {
  RUN_ARTIFACT_AUTHORITY,
  RunProjectionSchema,
  RunRepositoriesSnapshotSchema,
  RunVariablesSnapshotSchema,
  RunWorkflowSnapshotSchema,
  RunWorkspacesProjectionSchema,
  NodeExecutionProjectionSchema,
} from '../../src/index.js'

const timestamp = '2026-08-25T10:00:00.000Z'

const workflow = {
  schemaVersion: 2,
  workflowId: 'review-change',
  name: 'Review change',
  description: 'Review an implementation',
  repositories: {
    repositoryIds: ['repository-01'],
    primaryRepositoryId: 'repository-01',
  },
  variables: ['ticket'],
  graph: {
    startNodeId: 'reviewer',
    nodes: [
      {
        type: 'agent',
        id: 'reviewer',
        name: 'Reviewer',
        prompt: 'Review {{ ticket }}',
        harness: { harnessId: 'pi' },
      },
    ],
    edges: [],
    maxTransitions: 8,
  },
  createdAt: timestamp,
  updatedAt: timestamp,
} as const

describe('run artifact contracts', () => {
  it('validates immutable, schema-versioned admission snapshots', () => {
    expect(
      RunWorkflowSnapshotSchema.parse({
        schemaVersion: 1,
        capturedAt: timestamp,
        workflowRevision: 'a'.repeat(64),
        workflow,
      }),
    ).toMatchObject({ schemaVersion: 1, workflow })

    expect(
      RunVariablesSnapshotSchema.parse({
        schemaVersion: 1,
        values: { ticket: 'SLOP-28', options: { strict: true } },
      }),
    ).toEqual({
      schemaVersion: 1,
      values: { ticket: 'SLOP-28', options: { strict: true } },
    })

    expect(
      RunRepositoriesSnapshotSchema.parse({
        schemaVersion: 1,
        repositories: [
          {
            repositoryId: 'repository-01',
            position: 0,
            name: 'slopify',
            provider: 'GITHUB',
            remoteId: '123',
            fullName: 'slopify/slopify',
            cloneUrl: 'https://github.com/slopify/slopify.git',
            webUrl: 'https://github.com/slopify/slopify',
            defaultBranch: 'main',
            baseSha: 'b'.repeat(40),
            isPrimary: true,
          },
        ],
      }),
    ).toMatchObject({ schemaVersion: 1 })
  })

  it('validates rebuildable run, workspace, and node projections', () => {
    expect(
      RunProjectionSchema.parse({
        schemaVersion: 1,
        runId: 'run-01',
        workflowId: 'review-change',
        status: 'RUNNING',
        transitionCount: 1,
        lastEventSequence: 3,
        createdAt: timestamp,
        startedAt: timestamp,
        completedAt: null,
        failureCode: null,
      }),
    ).toMatchObject({ status: 'RUNNING', lastEventSequence: 3 })

    expect(
      RunWorkspacesProjectionSchema.parse({
        schemaVersion: 1,
        runId: 'run-01',
        lastEventSequence: 3,
        workspaces: [
          {
            repositoryId: 'repository-01',
            position: 0,
            status: 'READY',
            workspacePath: '/tmp/run-01/repository-01',
            branchName: 'slopify/run-01',
            errorMessage: null,
            preparedAt: timestamp,
            cleanedAt: null,
            updatedAt: timestamp,
          },
        ],
      }),
    ).toMatchObject({ lastEventSequence: 3 })

    expect(
      NodeExecutionProjectionSchema.parse({
        schemaVersion: 1,
        runId: 'run-01',
        nodeExecutionId: 'node-execution-01',
        attemptId: 'attempt-01',
        nodeId: 'reviewer',
        executionIndex: 0,
        status: 'PENDING',
        lastEventSequence: 3,
        output: null,
        outcome: null,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
      }),
    ).toMatchObject({ executionIndex: 0, status: 'PENDING' })
  })

  it.each([
    [RunWorkflowSnapshotSchema, { schemaVersion: 2, capturedAt: timestamp }],
    [RunVariablesSnapshotSchema, { schemaVersion: 1, values: {}, extra: true }],
    [RunProjectionSchema, { schemaVersion: 1, runId: '../escape' }],
  ])('rejects invalid or extended artifacts', (schema, value) => {
    expect(schema.safeParse(value).success).toBe(false)
  })

  it('classifies immutable and append-only facts separately from projections', () => {
    expect(RUN_ARTIFACT_AUTHORITY).toEqual({
      workflowSnapshot: 'IMMUTABLE_FACT',
      variablesSnapshot: 'IMMUTABLE_FACT',
      repositoriesSnapshot: 'IMMUTABLE_FACT',
      runEvents: 'APPEND_ONLY_FACT',
      traceEvents: 'APPEND_ONLY_FACT',
      run: 'REBUILDABLE_PROJECTION',
      workspaces: 'REBUILDABLE_PROJECTION',
      nodeExecution: 'REBUILDABLE_PROJECTION',
    })
  })
})
