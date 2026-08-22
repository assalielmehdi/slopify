import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ExecutionMessagePayloadSchema,
  createInMemoryExecutionMessageQueue,
  createSqliteExecutionMessageQueue,
  openDatabase,
  type ExecutionMessageQueue,
  type WorkbenchDatabase,
} from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'

const databases: WorkbenchDatabase[] = []
const directories: string[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const queueFactories: readonly [string, () => ExecutionMessageQueue][] = [
  ['memory', () => createInMemoryExecutionMessageQueue()],
  [
    'sqlite',
    () => {
      const directory = join(tmpdir(), `slopify-queue-${crypto.randomUUID()}`)
      directories.push(directory)
      const database = openDatabase({ path: join(directory, 'state.sqlite') })
      databases.push(database)
      const timestamp = '2026-08-20T10:00:00.000Z'
      getDatabaseHandle(database).exec(`
        INSERT INTO workflows (
          workflow_id, name, description, definition_json, created_at, updated_at
        ) VALUES (
          'workflow-01', 'Workflow', 'Queue fixture', '{}', '${timestamp}', '${timestamp}'
        );
        INSERT INTO project_profiles (
          profile_id, display_name, clickup_workspace_id, clickup_list_id,
          clickup_in_review_status_id, created_at, updated_at
        ) VALUES (
          'profile-01', 'Profile', 'workspace-01', 'list-01', 'review',
          '${timestamp}', '${timestamp}'
        );
        INSERT INTO project_profile_snapshots (
          snapshot_id, profile_id, display_name, clickup_workspace_id,
          clickup_list_id, clickup_in_review_status_id, created_at
        ) VALUES (
          'snapshot-01', 'profile-01', 'Profile', 'workspace-01',
          'list-01', 'review', '${timestamp}'
        );
        INSERT INTO runs (
          run_id, workflow_id, profile_snapshot_id, task_reference,
          task_snapshot_json, workflow_snapshot_json, variables_json,
          missing_variables_json, status, created_at
        ) VALUES (
          'run-01', 'workflow-01', 'snapshot-01', 'TASK-1',
          '{}', '{}', '{}', '[]', 'PENDING', '${timestamp}'
        );
      `)
      return createSqliteExecutionMessageQueue(database)
    },
  ],
]

const command = {
  id: 'message-01',
  destination: 'WORKER' as const,
  type: 'EXECUTE_JOB' as const,
  runId: 'run-01',
  nodeExecutionId: 'node-execution-01',
  attemptId: 'attempt-01',
  payload: {
    version: 1 as const,
    nodeId: 'plan',
    jobKind: 'agent' as const,
  },
  availableAt: '2026-08-20T10:00:00.000Z',
  createdAt: '2026-08-20T10:00:00.000Z',
}

describe.each(queueFactories)('%s execution message queue', (_, createQueue) => {
  it('separates destinations and atomically gives a claim to only one consumer', () => {
    const queue = createQueue()
    queue.enqueue(command)

    expect(
      queue.claimNext({
        destination: 'COORDINATOR',
        consumerId: 'coordinator-01',
        now: command.availableAt,
        leaseDurationMs: 30_000,
      }),
    ).toBeUndefined()

    const first = queue.claimNext({
      destination: 'WORKER',
      consumerId: 'worker-01',
      now: command.availableAt,
      leaseDurationMs: 30_000,
    })
    const second = queue.claimNext({
      destination: 'WORKER',
      consumerId: 'worker-02',
      now: command.availableAt,
      leaseDurationMs: 30_000,
    })

    expect(first).toMatchObject({ status: 'CLAIMED', claimedBy: 'worker-01', attempts: 1 })
    expect(second).toBeUndefined()
  })

  it('renews an owned lease and recovers an expired claim only when retry is explicit', () => {
    const queue = createQueue()
    queue.enqueue(command)
    queue.claimNext({
      destination: 'WORKER',
      consumerId: 'worker-01',
      now: command.availableAt,
      leaseDurationMs: 1_000,
    })

    expect(
      queue.renewClaim({
        messageId: command.id,
        consumerId: 'worker-02',
        now: '2026-08-20T10:00:00.500Z',
        leaseDurationMs: 1_000,
      }),
    ).toBe(false)
    expect(
      queue.recoverExpired({
        destination: 'WORKER',
        now: '2026-08-20T10:00:01.001Z',
        retry: false,
      }),
    ).toEqual([])
    expect(
      queue.recoverExpired({
        destination: 'WORKER',
        now: '2026-08-20T10:00:01.001Z',
        retry: true,
      }),
    ).toEqual(['message-01'])
  })

  it('atomically completes a worker command with one terminal coordinator fact', () => {
    const queue = createQueue()
    queue.enqueue(command)
    queue.claimNext({
      destination: 'WORKER',
      consumerId: 'worker-01',
      now: command.availableAt,
      leaseDurationMs: 30_000,
    })

    queue.completeClaim({
      messageId: command.id,
      consumerId: 'worker-01',
      processedAt: '2026-08-20T10:00:02.000Z',
      emitted: [
        {
          id: 'message-02',
          destination: 'COORDINATOR',
          type: 'JOB_SUCCEEDED',
          runId: command.runId,
          nodeExecutionId: command.nodeExecutionId,
          attemptId: command.attemptId,
          payload: {
            version: 1,
            outcome: 'ready',
            output: { summary: 'Done' },
            artifactIds: [],
            completedAt: '2026-08-20T10:00:02.000Z',
            durationMs: 2_000,
          },
          availableAt: '2026-08-20T10:00:02.000Z',
          createdAt: '2026-08-20T10:00:02.000Z',
        },
      ],
    })

    expect(queue.get(command.id)).toMatchObject({ status: 'PROCESSED' })
    expect(queue.list({ destination: 'COORDINATOR' })).toHaveLength(1)
  })

  it('cancels only pending worker commands for one run', () => {
    const queue = createQueue()
    queue.enqueue(command)

    expect(
      queue.cancelPendingRunCommands({
        runId: command.runId,
        processedAt: '2026-08-20T10:00:01.000Z',
      }),
    ).toEqual([command.id])
    expect(queue.get(command.id)).toMatchObject({
      status: 'PROCESSED',
      processedAt: '2026-08-20T10:00:01.000Z',
    })
  })
})

describe('execution message payloads', () => {
  it('rejects unversioned and unknown payload properties', () => {
    expect(() =>
      ExecutionMessagePayloadSchema.parse({
        type: 'EXECUTE_JOB',
        payload: { nodeId: 'plan', jobKind: 'agent' },
      }),
    ).toThrow()
    expect(() =>
      ExecutionMessagePayloadSchema.parse({
        type: 'EXECUTE_JOB',
        payload: { version: 1, nodeId: 'plan', jobKind: 'agent', graph: {} },
      }),
    ).toThrow()
  })
})
