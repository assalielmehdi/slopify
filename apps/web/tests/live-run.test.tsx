// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RunEventSchema, type RunEvent, type RunStatus } from '@loop/contracts'
import { createDeliveryWorkflowTestRevision } from '../../../packages/execution-runtime/tests/fixtures/delivery-workflow'

import { LiveRun } from '../components/runs/live-run'
import { RunStatusBadge } from '../components/runs/run-status'
import type { RunEventConnectionHandlers, RunEventConnector } from '../lib/event-stream'
import type { RunDetailResponse, StartRunResponse } from '../lib/api-client'

vi.mock('../components/workflow/workflow-canvas', () => ({
  WorkflowCanvas: ({
    onNodeSelect,
    recentRunStatuses,
    revision,
    selectedNodeId,
  }: {
    onNodeSelect: (nodeId: string) => void
    recentRunStatuses: Readonly<Record<string, string>>
    revision: { revisionId: string }
    selectedNodeId: string
  }) => (
    <div aria-label="Workflow graph" role="region">
      <p>
        Graph {revision.revisionId}; current {selectedNodeId}; statuses{' '}
        {JSON.stringify(recentRunStatuses)}
      </p>
      <button type="button" onClick={() => onNodeSelect('implement')}>
        Inspect Implement transcript
      </button>
    </div>
  ),
}))

const revision = createDeliveryWorkflowTestRevision({
  revisionId: 'revision-01',
  createdAt: '2026-08-20T10:00:00Z',
  agentDefaults: {
    provider: 'test-provider',
    model: 'test-model',
    thinkingLevel: 'high',
  },
})

const events = RunEventSchema.array().parse([
  {
    runId: 'run-01',
    sequence: 1,
    timestamp: '2026-08-20T10:00:00Z',
    type: 'RUN_STARTED',
    data: {
      workflowId: revision.workflowId,
      revisionId: revision.revisionId,
      profileId: 'local-profile',
      taskReference: 'PROJ-42',
    },
  },
  {
    runId: 'run-01',
    sequence: 2,
    timestamp: '2026-08-20T10:00:01Z',
    type: 'RUN_STATUS_CHANGED',
    data: { from: 'PENDING', to: 'RUNNING' },
  },
  {
    runId: 'run-01',
    sequence: 3,
    timestamp: '2026-08-20T10:00:02Z',
    type: 'NODE_STARTED',
    nodeId: 'implement',
    data: {},
  },
  {
    runId: 'run-01',
    sequence: 4,
    timestamp: '2026-08-20T10:00:03Z',
    type: 'NODE_OUTPUT',
    nodeId: 'implement',
    data: {
      channel: 'agent',
      content: '<script>alert("unsafe")</script> implementation complete',
      repositoryId: 'web',
    },
  },
  {
    runId: 'run-01',
    sequence: 5,
    timestamp: '2026-08-20T10:00:04Z',
    type: 'NODE_COMPLETED',
    nodeId: 'implement',
    data: { outcome: 'implemented', durationMs: 2_000, artifactIds: ['artifact-01'] },
  },
  {
    runId: 'run-01',
    sequence: 6,
    timestamp: '2026-08-20T10:00:05Z',
    type: 'EDGE_SELECTED',
    nodeId: 'implement',
    data: { outcome: 'implemented', targetNodeId: 'verify' },
  },
  {
    runId: 'run-01',
    sequence: 7,
    timestamp: '2026-08-20T10:00:06Z',
    type: 'NODE_STARTED',
    nodeId: 'verify',
    data: {},
  },
])

const run = {
  runId: 'run-01',
  workflowId: revision.workflowId,
  revisionId: revision.revisionId,
  profileSnapshotId: 'profile-snapshot-01',
  taskReference: 'PROJ-42',
  notes: 'Coordinate the frontend and API repositories.',
  taskSnapshot: {
    taskId: '86abc123',
    title: 'Follow and cancel a live run',
    url: 'https://app.clickup.com/t/86abc123',
  },
  effectiveConfiguration: revision,
  status: 'RUNNING',
  currentNodeId: 'verify',
  transitionCount: 2,
  createdAt: '2026-08-20T10:00:00Z',
  startedAt: '2026-08-20T10:00:01Z',
  completedAt: null,
} as const

const detail = {
  run,
  workflowRevision: revision,
  profileSnapshot: {
    snapshotId: 'profile-snapshot-01',
    profileId: 'local-profile',
    displayName: 'Local delivery',
    clickupWorkspaceId: 'workspace-01',
    clickupListId: 'list-01',
    clickupInReviewStatusId: 'in-review',
    createdAt: '2026-08-20T10:00:00Z',
    repositories: [
      {
        repositoryId: 'api',
        profilePosition: 0,
        displayName: 'API',
        purpose: 'Backend services',
        repositoryPath: '/workspace/api',
        gitlabProject: 'group/api',
        remote: 'origin',
        targetBranch: 'main',
        worktreeParent: '/workspace/.worktrees',
        branchTemplate: 'ai/{task}-{run}',
        executableChecks: [],
        verificationCommands: [],
        mergeRequestLabels: [],
      },
      {
        repositoryId: 'web',
        profilePosition: 1,
        displayName: 'Web',
        purpose: 'Operator workbench',
        repositoryPath: '/workspace/web',
        gitlabProject: 'group/web',
        remote: 'origin',
        targetBranch: 'develop',
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
      nodeExecutionId: 'node-execution-01',
      nodeId: 'implement',
      executionIndex: 0,
      status: 'SUCCEEDED',
      inputReferences: {},
      output: { summary: 'Implemented the live view.' },
      outcome: 'implemented',
      errorCode: null,
      errorMessage: null,
      selectedTargetNodeId: 'verify',
      startedAt: '2026-08-20T10:00:02Z',
      completedAt: '2026-08-20T10:00:04Z',
      durationMs: 2_000,
    },
    {
      nodeExecutionId: 'node-execution-02',
      nodeId: 'verify',
      executionIndex: 0,
      status: 'RUNNING',
      inputReferences: {},
      output: null,
      outcome: null,
      errorCode: null,
      errorMessage: null,
      selectedTargetNodeId: null,
      startedAt: '2026-08-20T10:00:06Z',
      completedAt: null,
      durationMs: null,
    },
  ],
  repositorySelection: {
    selected: [
      {
        repositoryId: 'web',
        rationale: 'The operator view owns this capability.',
        responsibility: 'Implement and verify the live run UI.',
      },
    ],
    excluded: [{ repositoryId: 'api', rationale: 'The existing API contract is sufficient.' }],
  },
  workspaces: [
    {
      repositoryId: 'web',
      profilePosition: 1,
      repositoryPath: '/workspace/web',
      worktreePath: '/workspace/.worktrees/run-01-web',
      remote: 'origin',
      targetBranch: 'develop',
      sourceBranch: 'ai/proj-42-run-01',
      baseSha: '1111111111111111111111111111111111111111',
      createdAt: '2026-08-20T10:00:02Z',
    },
  ],
  deliveryEvidence: [
    {
      repositoryId: 'web',
      profilePosition: 1,
      status: 'VERIFIED',
      gitlabProject: 'group/web',
      mergeRequestIid: 42,
      mergeRequestUrl: 'https://gitlab.example.com/group/web/-/merge_requests/42',
      sourceBranch: 'ai/proj-42-run-01',
      targetBranch: 'develop',
      headSha: '2222222222222222222222222222222222222222',
      evidence: { checks: ['pnpm test'], review: 'approved' },
      updatedAt: '2026-08-20T10:00:07Z',
    },
  ],
  outputChunks: [
    {
      sequence: 1,
      eventSequence: 4,
      nodeExecutionId: 'node-execution-01',
      channel: 'agent',
      repositoryId: 'web',
      content: '<script>alert("unsafe")</script> implementation complete',
      createdAt: '2026-08-20T10:00:03Z',
    },
  ],
  artifacts: [
    {
      artifactId: 'artifact-01',
      nodeExecutionId: 'node-execution-01',
      artifactType: 'IMPLEMENTATION_SUMMARY',
      content: 'Implementation summary',
      metadata: { clickupUrl: 'https://app.clickup.com/t/86abc123#comment-1' },
      createdAt: '2026-08-20T10:00:04Z',
    },
  ],
} as unknown as RunDetailResponse

const createConnector = () => {
  let handlers: RunEventConnectionHandlers | undefined
  const close = vi.fn()
  const connector: RunEventConnector = vi.fn((_url, nextHandlers) => {
    handlers = nextHandlers
    return close
  })
  return { close, connector, handlers: () => handlers }
}

afterEach(cleanup)

describe('LiveRun', () => {
  it('shows the structured agent result when Pi completes without a message delta', async () => {
    const terminalDetail = {
      ...detail,
      events: events.map((event) =>
        event.sequence === 4 && event.type === 'NODE_OUTPUT'
          ? {
              ...event,
              data: {
                ...event.data,
                content: JSON.stringify({ eventType: 'AGENT_STARTED', data: {} }),
              },
            }
          : event,
      ),
      nodeExecutions: detail.nodeExecutions.map((execution) =>
        execution.nodeId === 'implement'
          ? {
              ...execution,
              output: {
                summary: 'Answered the user.',
                data: { response: 'I am Pi, an AI coding assistant.' },
              },
            }
          : execution,
      ),
    }
    const client = {
      getRun: vi.fn(async () => terminalDetail as unknown as RunDetailResponse),
      cancelRun: vi.fn(),
    }

    render(<LiveRun runId="run-01" client={client} connect={createConnector().connector} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Implement transcript' }))

    expect(screen.getByText('I am Pi, an AI coding assistant.')).toBeTruthy()
  })

  it('opens the selected agent transcript and streams reasoning and response chunks', async () => {
    const transcriptEvents = RunEventSchema.array().parse([
      ...events,
      {
        runId: 'run-01',
        sequence: 8,
        timestamp: '2026-08-20T10:00:07Z',
        type: 'NODE_OUTPUT',
        nodeId: 'implement',
        data: {
          channel: 'agent',
          content: JSON.stringify({
            eventType: 'AGENT_REASONING',
            data: { content: 'I should inspect the code first.' },
          }),
        },
      },
    ])
    const transcriptDetail = { ...detail, events: transcriptEvents }
    const client = {
      getRun: vi.fn(async () => transcriptDetail as unknown as RunDetailResponse),
      cancelRun: vi.fn(),
    }
    const connection = createConnector()

    render(<LiveRun runId="run-01" client={client} connect={connection.connector} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Implement transcript' }))

    expect(screen.getByRole('dialog', { name: 'Implement transcript' })).toBeTruthy()
    expect(
      screen.getByText(
        'Implement only the approved execution plan across the selected worktrees. Verify changes incrementally and commit each repository-specific result.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('I should inspect the code first.')).toBeTruthy()

    await waitFor(() => expect(connection.connector).toHaveBeenCalled())

    act(() => {
      connection.handlers()?.onEvent(
        RunEventSchema.parse({
          runId: 'run-01',
          sequence: 9,
          timestamp: '2026-08-20T10:00:08Z',
          type: 'NODE_OUTPUT',
          nodeId: 'implement',
          data: {
            channel: 'agent',
            content: JSON.stringify({
              eventType: 'AGENT_MESSAGE',
              data: { content: 'Implementation complete.' },
            }),
          },
        }),
      )
    })

    expect(await screen.findByText(/Implementation complete\.$/)).toBeTruthy()
  })

  it('renders the pinned graph, ordered events, and complete repository evidence as text', async () => {
    const client = { getRun: vi.fn(async () => detail), cancelRun: vi.fn() }
    const connection = createConnector()

    render(<LiveRun runId="run-01" client={client} connect={connection.connector} />)

    expect(await screen.findByRole('heading', { name: 'Run run-01' })).toBeTruthy()
    expect(screen.getByText('Pinned revision revision-01')).toBeTruthy()
    expect(screen.getByText('Current node: Verify')).toBeTruthy()
    expect(screen.getByText('Selected transition: implemented → verify')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Workflow graph' }).textContent).toContain(
      '"verify":"RUNNING"',
    )
    expect(screen.getByRole('heading', { name: 'Web' })).toBeTruthy()
    expect(screen.getByText('The operator view owns this capability.')).toBeTruthy()
    expect(screen.getByText('/workspace/.worktrees/run-01-web')).toBeTruthy()
    expect(screen.getByText('The existing API contract is sufficient.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Created merge request !42' })).toHaveProperty(
      'href',
      'https://gitlab.example.com/group/web/-/merge_requests/42',
    )
    expect(screen.getByRole('link', { name: 'Artifact link 1' })).toHaveProperty(
      'href',
      'https://app.clickup.com/t/86abc123#comment-1',
    )
    expect(
      screen.getByText('<script>alert("unsafe")</script> implementation complete'),
    ).toBeTruthy()
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeTruthy()
    expect(connection.connector).toHaveBeenCalledWith('/api/runs/run-01/events', expect.any(Object))
  })

  it('deduplicates replay, fills a sequence gap from a snapshot, and reconciles reconnects', async () => {
    const gapEvent = RunEventSchema.parse({
      runId: 'run-01',
      sequence: 9,
      timestamp: '2026-08-20T10:00:08Z',
      type: 'EDGE_SELECTED',
      nodeId: 'verify',
      data: { outcome: 'passed', targetNodeId: 'requirements-review' },
    })
    const missingEvent = RunEventSchema.parse({
      runId: 'run-01',
      sequence: 8,
      timestamp: '2026-08-20T10:00:07Z',
      type: 'NODE_COMPLETED',
      nodeId: 'verify',
      data: { outcome: 'passed', durationMs: 1_000, artifactIds: [] },
    })
    const reconciled = { ...detail, events: [...events, missingEvent, gapEvent] }
    const client = {
      getRun: vi
        .fn<() => Promise<RunDetailResponse>>()
        .mockResolvedValueOnce(detail)
        .mockResolvedValue(reconciled),
      cancelRun: vi.fn(),
    }
    const connection = createConnector()

    render(<LiveRun runId="run-01" client={client} connect={connection.connector} />)
    await screen.findByRole('heading', { name: 'Run run-01' })
    const handlers = connection.handlers()
    expect(handlers).toBeDefined()

    handlers?.onEvent(events[3] as RunEvent)
    expect(screen.getAllByText(/implementation complete/)).toHaveLength(1)

    handlers?.onEvent(gapEvent)
    expect(screen.queryByText('Selected transition: passed → requirements-review')).toBeNull()
    await screen.findByText('Selected transition: passed → requirements-review')

    handlers?.onDisconnect()
    expect(screen.getByText('Reconnecting')).toBeTruthy()
    handlers?.onOpen()
    await waitFor(() => expect(client.getRun).toHaveBeenCalledTimes(3))
    expect(screen.getAllByText('Selected transition: passed → requirements-review')).toHaveLength(1)
  })

  it('ignores an obsolete snapshot after navigation selects another run', async () => {
    let resolveFirst: ((value: RunDetailResponse) => void) | undefined
    const secondEvents = RunEventSchema.array().parse(
      events.map((event) => ({ ...event, runId: 'run-02' })),
    )
    const secondDetail = {
      ...detail,
      run: { ...detail.run, runId: 'run-02' },
      events: secondEvents,
    } as unknown as RunDetailResponse
    const client = {
      getRun: vi.fn((selectedRunId: string) =>
        selectedRunId === 'run-01'
          ? new Promise<RunDetailResponse>((resolve) => {
              resolveFirst = resolve
            })
          : Promise.resolve(secondDetail),
      ),
      cancelRun: vi.fn(),
    }
    const firstConnection = createConnector()
    const view = render(
      <LiveRun runId="run-01" client={client} connect={firstConnection.connector} />,
    )
    await waitFor(() => expect(client.getRun).toHaveBeenCalledWith('run-01'))

    view.rerender(<LiveRun runId="run-02" client={client} connect={firstConnection.connector} />)
    expect(await screen.findByRole('heading', { name: 'Run run-02' })).toBeTruthy()
    resolveFirst?.(detail)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Run run-02' })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Run run-01' })).toBeNull()
    })
  })

  it('keeps running state until cancellation is confirmed and then closes the stream', async () => {
    let confirmCancel: ((value: StartRunResponse) => void) | undefined
    const cancelRun = vi.fn(
      () =>
        new Promise<StartRunResponse>((resolve) => {
          confirmCancel = resolve
        }),
    )
    const cancelledEvents = RunEventSchema.array().parse([
      ...events,
      {
        runId: 'run-01',
        sequence: 8,
        timestamp: '2026-08-20T10:00:07Z',
        type: 'RUN_CANCEL_REQUESTED',
        data: { reason: 'Cancelled from the workbench' },
      },
      {
        runId: 'run-01',
        sequence: 9,
        timestamp: '2026-08-20T10:00:08Z',
        type: 'NODE_FAILED',
        nodeId: 'verify',
        data: { code: 'EXECUTOR_CANCELLED', message: 'Cancelled', durationMs: 2_000 },
      },
      {
        runId: 'run-01',
        sequence: 10,
        timestamp: '2026-08-20T10:00:09Z',
        type: 'RUN_COMPLETED',
        data: { status: 'CANCELLED', durationMs: 8_000 },
      },
    ])
    const cancelledRun = {
      ...run,
      status: 'CANCELLED',
      currentNodeId: null,
      completedAt: '2026-08-20T10:00:09Z',
    } as unknown as StartRunResponse
    const cancelledDetail = {
      ...detail,
      run: cancelledRun,
      events: cancelledEvents,
      nodeExecutions: detail.nodeExecutions.map((execution) =>
        execution.nodeId === 'verify'
          ? {
              ...execution,
              status: 'CANCELLED' as const,
              errorCode: 'EXECUTOR_CANCELLED',
              errorMessage: 'Cancelled',
              completedAt: '2026-08-20T10:00:09Z',
              durationMs: 2_000,
            }
          : execution,
      ),
    }
    const client = {
      getRun: vi
        .fn<() => Promise<RunDetailResponse>>()
        .mockResolvedValueOnce(detail)
        .mockResolvedValue(cancelledDetail),
      cancelRun,
    }
    const connection = createConnector()

    render(<LiveRun runId="run-01" client={client} connect={connection.connector} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }))

    expect(screen.getAllByText('Running').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Cancelling…' })).toHaveProperty('disabled', true)
    confirmCancel?.(cancelledRun)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull())
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0)
    expect(cancelRun).toHaveBeenCalledWith('run-01', { reason: 'Cancelled from the workbench' })
    expect(connection.close).toHaveBeenCalled()
  })
})

describe('RunStatusBadge', () => {
  it('exposes every run state textually instead of relying on color', () => {
    const statuses: readonly RunStatus[] = [
      'PENDING',
      'RUNNING',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'INTERRUPTED',
    ]

    render(
      <div>
        {statuses.map((status) => (
          <RunStatusBadge key={status} status={status} />
        ))}
      </div>,
    )

    for (const label of ['Pending', 'Running', 'Succeeded', 'Failed', 'Cancelled', 'Interrupted']) {
      expect(within(document.body).getByText(label)).toBeTruthy()
    }
  })
})
