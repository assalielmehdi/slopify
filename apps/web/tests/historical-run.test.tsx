// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RunEventSchema } from '@loop/contracts'
import { createDeliveryWorkflowTestRevision } from '../../../packages/execution-runtime/tests/fixtures/delivery-workflow'

import { LiveRun } from '../components/runs/live-run'
import { createApiClient, type RunDetailResponse } from '../lib/api-client'
import type { RunEventConnector } from '../lib/event-stream'

vi.mock('../components/workflow/workflow-canvas', () => ({
  WorkflowCanvas: ({ revision }: { revision: { revisionId: string } }) => (
    <div aria-label="Workflow graph" role="region">
      Graph {revision.revisionId}
    </div>
  ),
}))

const revision = createDeliveryWorkflowTestRevision({
  revisionId: 'revision-historical',
  createdAt: '2026-08-19T10:00:00Z',
  agentDefaults: {
    provider: 'historical-provider',
    model: 'historical-model',
    thinkingLevel: 'high',
  },
})

const events = RunEventSchema.array().parse([
  {
    runId: 'run-historical',
    sequence: 1,
    timestamp: '2026-08-19T10:00:01Z',
    type: 'RUN_STARTED',
    data: {
      workflowId: revision.workflowId,
      revisionId: revision.revisionId,
      profileId: 'historical-profile',
      taskReference: 'LOOP-38',
    },
  },
  {
    runId: 'run-historical',
    sequence: 2,
    timestamp: '2026-08-19T10:00:02Z',
    type: 'RUN_STATUS_CHANGED',
    data: { from: 'PENDING', to: 'RUNNING' },
  },
  {
    runId: 'run-historical',
    sequence: 3,
    timestamp: '2026-08-19T10:00:03Z',
    type: 'NODE_STARTED',
    nodeId: 'verify',
    data: {},
  },
  {
    runId: 'run-historical',
    sequence: 4,
    timestamp: '2026-08-19T10:00:04Z',
    type: 'NODE_OUTPUT',
    nodeId: 'verify',
    data: { channel: 'stderr', content: 'Historical check output', repositoryId: 'web' },
  },
  {
    runId: 'run-historical',
    sequence: 5,
    timestamp: '2026-08-19T10:00:05Z',
    type: 'NODE_FAILED',
    nodeId: 'verify',
    data: { code: 'CHECK_FAILED', message: 'Historical verification failed', durationMs: 2_000 },
  },
  {
    runId: 'run-historical',
    sequence: 6,
    timestamp: '2026-08-19T10:00:06Z',
    type: 'RUN_STATUS_CHANGED',
    data: { from: 'RUNNING', to: 'FAILED' },
  },
  {
    runId: 'run-historical',
    sequence: 7,
    timestamp: '2026-08-19T10:00:07Z',
    type: 'RUN_COMPLETED',
    data: { status: 'FAILED', durationMs: 6_000 },
  },
])

const detail = {
  run: {
    runId: 'run-historical',
    workflowId: revision.workflowId,
    revisionId: revision.revisionId,
    profileSnapshotId: 'profile-snapshot-historical',
    taskReference: 'LOOP-38',
    notes: 'Historical operator note',
    taskSnapshot: { title: 'Inspect exact historical evidence' },
    effectiveConfiguration: { model: 'historical-model' },
    status: 'FAILED',
    currentNodeId: null,
    transitionCount: 2,
    createdAt: '2026-08-19T10:00:00Z',
    startedAt: '2026-08-19T10:00:01Z',
    completedAt: '2026-08-19T10:00:07Z',
  },
  workflowRevision: revision,
  profileSnapshot: {
    snapshotId: 'profile-snapshot-historical',
    profileId: 'historical-profile',
    displayName: 'Historical delivery',
    clickupWorkspaceId: 'workspace-01',
    clickupListId: 'list-01',
    clickupInReviewStatusId: 'in-review',
    createdAt: '2026-08-19T10:00:00Z',
    repositories: [
      {
        repositoryId: 'web',
        profilePosition: 0,
        displayName: 'Web',
        purpose: 'Operator workbench',
        repositoryPath: '/workspace/web',
        gitlabProject: 'group/web',
        remote: 'origin',
        targetBranch: 'main',
        worktreeParent: '/workspace/.worktrees',
        branchTemplate: 'ai/{task}-{run}',
        executableChecks: [],
        verificationCommands: [],
        mergeRequestLabels: [],
      },
    ],
  },
  events,
  nodeExecutions: [
    {
      nodeExecutionId: 'node-execution-historical',
      nodeId: 'verify',
      executionIndex: 0,
      status: 'FAILED',
      inputReferences: {},
      output: null,
      outcome: null,
      errorCode: 'CHECK_FAILED',
      errorMessage: 'Historical verification failed',
      selectedTargetNodeId: null,
      startedAt: '2026-08-19T10:00:03Z',
      completedAt: '2026-08-19T10:00:05Z',
      durationMs: 2_000,
    },
  ],
  repositorySelection: {
    selected: [
      {
        repositoryId: 'web',
        rationale: 'Historical selection rationale',
        responsibility: 'Historical UI evidence',
      },
    ],
    excluded: [],
  },
  workspaces: [
    {
      repositoryId: 'web',
      profilePosition: 0,
      repositoryPath: '/workspace/web',
      worktreePath: '/workspace/.worktrees/run-historical-web',
      remote: 'origin',
      targetBranch: 'main',
      sourceBranch: 'ai/loop-38-run-historical',
      baseSha: '1111111111111111111111111111111111111111',
      createdAt: '2026-08-19T10:00:02Z',
    },
  ],
  deliveryEvidence: [
    {
      repositoryId: 'web',
      profilePosition: 0,
      status: 'MERGE_REQUEST_CREATED',
      gitlabProject: 'group/web',
      mergeRequestIid: 38,
      mergeRequestUrl: 'https://gitlab.example.com/group/web/-/merge_requests/38',
      sourceBranch: 'ai/loop-38-run-historical',
      targetBranch: 'main',
      headSha: '2222222222222222222222222222222222222222',
      evidence: { creation: 'recorded' },
      updatedAt: '2026-08-19T10:00:07Z',
    },
  ],
  outputChunks: [],
  artifacts: [
    {
      artifactId: 'artifact-historical',
      nodeExecutionId: 'node-execution-historical',
      artifactType: 'REVIEW_SUMMARY',
      content: 'Historical verification artifact',
      metadata: {},
      createdAt: '2026-08-19T10:00:05Z',
    },
  ],
} as unknown as RunDetailResponse

afterEach(cleanup)

describe('historical run detail', () => {
  it('renders only the immutable terminal snapshot and does not open a live stream', async () => {
    const currentConfiguration = { profile: 'Current delivery', revision: 'revision-current' }
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(detail))
    const client = createApiClient({ fetch: fetchImplementation })
    const connect = vi.fn<RunEventConnector>()

    render(<LiveRun runId="run-historical" client={client} connect={connect} />)
    currentConfiguration.profile = 'Mutated current delivery'
    currentConfiguration.revision = 'revision-mutated'

    expect(await screen.findByRole('heading', { name: 'Run run-historical' })).toBeTruthy()
    expect(screen.getByText(/Historical delivery \(historical-profile\)/)).toBeTruthy()
    expect(screen.getByText(/snapshot profile-snapshot-historical/)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Workflow graph' }).textContent).toContain(
      'revision-historical',
    )
    expect(screen.queryByText(/Mutated current delivery|revision-mutated/)).toBeNull()
    expect(
      screen.getByText('Exact terminal snapshot; current configuration is not consulted.'),
    ).toBeTruthy()
    expect(screen.getByText('Stopped node: Verify (verify)')).toBeTruthy()
    expect(screen.getAllByText(/Historical verification failed/).length).toBeGreaterThan(0)
    expect(screen.getByText('Historical verification artifact')).toBeTruthy()

    const eventItems = within(screen.getByRole('list', { name: 'Run events' })).getAllByRole(
      'listitem',
    )
    expect(eventItems).toHaveLength(7)
    expect(eventItems[0]?.textContent).toContain('#1')
    expect(eventItems[6]?.textContent).toContain('#7')
    expect(screen.getByRole('link', { name: 'Created merge request !38' })).toHaveProperty(
      'href',
      'https://gitlab.example.com/group/web/-/merge_requests/38',
    )
    expect(
      screen.getByText(
        'A created merge request does not confirm pipeline success, approval, merge, deployment, or release.',
      ),
    ).toBeTruthy()
    expect(connect).not.toHaveBeenCalled()
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(fetchImplementation).toHaveBeenCalledWith('/api/runs/run-historical', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
  })
})
