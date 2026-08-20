import { describe, expect, it, vi } from 'vitest'

import { RunEventSchema, type RunEvent } from '@loop/contracts'
import { createPredefinedV1Revision } from '@loop/workflow-model'

import { createApiClient } from '../lib/api-client'
import { parseRunEvent, reconcileRunEvents, runEventStreamUrl } from '../lib/event-stream'

const event = (sequence: number, type: RunEvent['type'] = 'NODE_STARTED'): RunEvent =>
  RunEventSchema.parse(
    type === 'RUN_STARTED'
      ? {
          runId: 'run-01',
          sequence,
          timestamp: `2026-08-20T10:00:0${sequence}Z`,
          type,
          data: {
            workflowId: 'delivery-workflow',
            revisionId: 'revision-01',
            profileId: 'local-profile',
            taskReference: 'PROJ-42',
          },
        }
      : {
          runId: 'run-01',
          sequence,
          timestamp: `2026-08-20T10:00:0${sequence}Z`,
          type,
          nodeId: 'implementation',
          data: {},
        },
  )

const revision = createPredefinedV1Revision({
  revisionId: 'revision-01',
  createdAt: '2026-08-20T10:00:00Z',
  agentDefaults: {
    provider: 'test-provider',
    model: 'test-model',
    thinkingLevel: 'high',
  },
})

const run = {
  runId: 'run-01',
  workflowId: revision.workflowId,
  revisionId: revision.revisionId,
  profileSnapshotId: 'profile-snapshot-01',
  taskReference: 'PROJ-42',
  notes: null,
  taskSnapshot: { taskId: 'PROJ-42', title: 'Follow a live run' },
  effectiveConfiguration: revision,
  status: 'RUNNING',
  currentNodeId: 'implementation',
  transitionCount: 1,
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
  events: [event(1, 'RUN_STARTED'), event(2)],
  nodeExecutions: [],
  repositorySelection: null,
  workspaces: [],
  deliveryEvidence: [],
  outputChunks: [],
  artifacts: [],
}

describe('run event reconciliation', () => {
  it('deduplicates replayed events and retains one contiguous ordered sequence', () => {
    const result = reconcileRunEvents([event(1, 'RUN_STARTED'), event(2)], [event(2), event(3)])

    expect(result.requiresSnapshot).toBe(false)
    expect(result.events.map(({ sequence }) => sequence)).toEqual([1, 2, 3])
  })

  it('does not expose an event gap before a snapshot reconciles it', () => {
    const result = reconcileRunEvents([event(1, 'RUN_STARTED')], [event(3)])

    expect(result.requiresSnapshot).toBe(true)
    expect(result.events.map(({ sequence }) => sequence)).toEqual([1])
  })

  it('validates SSE data and uses a cursor-free same-origin URL', () => {
    expect(parseRunEvent(JSON.stringify(event(1, 'RUN_STARTED')))).toEqual(event(1, 'RUN_STARTED'))
    expect(() => parseRunEvent('{"sequence":2}')).toThrow()
    expect(runEventStreamUrl('run-01')).toBe('/api/runs/run-01/events')
    expect(() => runEventStreamUrl('../other')).toThrow()
  })
})

describe('live run API contract', () => {
  it('loads the exact pinned run detail and validates every evidence collection', async () => {
    const fetchImplementation = vi.fn(async () => Response.json(detail))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(client.getRun('run-01')).resolves.toEqual(detail)
    expect(fetchImplementation).toHaveBeenCalledWith('/api/runs/run-01', {
      headers: { accept: 'application/json' },
      method: 'GET',
    })
  })

  it('loads a repository-free run detail for the default workflow', async () => {
    const repositoryFreeDetail = {
      ...detail,
      profileSnapshot: { ...detail.profileSnapshot, repositories: [] },
    }
    const client = createApiClient({ fetch: async () => Response.json(repositoryFreeDetail) })

    await expect(client.getRun('run-01')).resolves.toEqual(repositoryFreeDetail)
  })

  it('cancels without an optimistic status and trusts only the confirmed run response', async () => {
    const cancelledRun = {
      ...run,
      status: 'CANCELLED',
      currentNodeId: null,
      completedAt: '2026-08-20T10:00:09Z',
    } as const
    const fetchImplementation = vi.fn(async () => Response.json(cancelledRun))
    const client = createApiClient({ fetch: fetchImplementation })

    await expect(
      client.cancelRun('run-01', { reason: 'Operator stopped the run' }),
    ).resolves.toEqual(cancelledRun)
    expect(fetchImplementation).toHaveBeenCalledWith('/api/runs/run-01/cancel', {
      body: JSON.stringify({ reason: 'Operator stopped the run' }),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    })
  })
})
