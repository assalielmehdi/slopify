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
import { createTestAgentWorkflow } from '../persistence/test-fixture.js'

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
      const workflow = createTestAgentWorkflow({ workflowId: 'workflow-01', createdAt: timestamp })
      const connection = getDatabaseHandle(database)
      connection
        .prepare(`INSERT INTO workflows (workflow_id, definition_json) VALUES (?, ?)`)
        .run(workflow.workflowId, JSON.stringify(workflow))
      connection
        .prepare(
          `INSERT INTO runs (
             run_id, workflow_id, variables_json, workflow_snapshot_json, status, created_at
           ) VALUES (?, ?, '{}', ?, 'PENDING', ?)`,
        )
        .run('run-01', workflow.workflowId, JSON.stringify(workflow), timestamp)
      return createSqliteExecutionMessageQueue(database)
    },
  ],
]

const command = {
  id: 'message-01',
  destination: 'WORKER' as const,
  type: 'EXECUTE_NODE' as const,
  runId: 'run-01',
  nodeExecutionId: 'node-execution-01',
  attemptId: 'attempt-01',
  payload: {
    version: 1 as const,
    nodeId: 'plan',
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
          type: 'NODE_EXECUTION_SUCCEEDED',
          runId: command.runId,
          nodeExecutionId: command.nodeExecutionId,
          attemptId: command.attemptId,
          payload: {
            version: 1,
            outcome: 'ready',
            output: { summary: 'Done' },
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
        type: 'EXECUTE_NODE',
        payload: { nodeId: 'plan' },
      }),
    ).toThrow()
    expect(() =>
      ExecutionMessagePayloadSchema.parse({
        type: 'EXECUTE_NODE',
        payload: { version: 1, nodeId: 'plan', graph: {} },
      }),
    ).toThrow()
  })
})
