import { describe, expect, it, vi } from 'vitest'

import {
  createExecutionWorker,
  createInMemoryExecutionMessageQueue,
  type NodeRunner,
} from '../../src/index.js'

const timestamp = '2026-08-20T12:00:00.000Z'

describe('execution worker', () => {
  it('is graph-neutral and publishes one terminal fact for a claimed node', async () => {
    const queue = createInMemoryExecutionMessageQueue()
    queue.enqueue({
      id: 'command-01',
      destination: 'WORKER',
      type: 'EXECUTE_NODE',
      runId: 'run-01',
      nodeExecutionId: 'node-execution-01',
      attemptId: 'attempt-01',
      payload: { version: 1, nodeId: 'plan' },
      availableAt: timestamp,
      createdAt: timestamp,
    })
    const runner: NodeRunner = {
      run: vi.fn(async () => {
        return {
          status: 'succeeded',
          outcome: 'ready',
          output: { summary: 'Done' },
        }
      }),
      cancel: vi.fn(async () => ({ status: 'cancelled' })),
    }
    const worker = createExecutionWorker({
      workerId: 'worker-01',
      queue,
      runner,
      now: () => timestamp,
      createMessageId: (() => {
        let id = 0
        return () => `fact-${++id}`
      })(),
    })

    expect(await worker.runOnce()).toBe(true)
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-01',
        nodeExecutionId: 'node-execution-01',
        attemptId: 'attempt-01',
        nodeId: 'plan',
      }),
    )
    expect(queue.list({ destination: 'COORDINATOR' }).map(({ type }) => type)).toEqual([
      'NODE_EXECUTION_STARTED',
      'NODE_EXECUTION_SUCCEEDED',
    ])
    expect(queue.get('command-01')).toMatchObject({ status: 'PROCESSED' })
  })

  it('does not exceed its configured concurrency', async () => {
    const queue = createInMemoryExecutionMessageQueue()
    for (let index = 1; index <= 4; index += 1) {
      queue.enqueue({
        id: `command-${index}`,
        destination: 'WORKER',
        type: 'EXECUTE_NODE',
        runId: 'run-01',
        nodeExecutionId: `node-execution-${index}`,
        attemptId: `attempt-${index}`,
        payload: { version: 1, nodeId: `node-${index}` },
        availableAt: timestamp,
        createdAt: timestamp,
      })
    }
    let active = 0
    let maximum = 0
    const runner: NodeRunner = {
      async run() {
        active += 1
        maximum = Math.max(maximum, active)
        await Promise.resolve()
        active -= 1
        return { status: 'succeeded', outcome: 'done', output: {} }
      },
      async cancel() {
        return { status: 'cancelled' }
      },
    }
    const worker = createExecutionWorker({
      workerId: 'worker-01',
      concurrency: 2,
      queue,
      runner,
      now: () => timestamp,
    })

    expect(await worker.drain()).toBe(4)
    expect(maximum).toBe(2)
  })

  it('converts an unexpected runner exception into one sanitized failure fact', async () => {
    const queue = createInMemoryExecutionMessageQueue()
    queue.enqueue({
      id: 'command-throw',
      destination: 'WORKER',
      type: 'EXECUTE_NODE',
      runId: 'run-01',
      nodeExecutionId: 'node-execution-throw',
      attemptId: 'attempt-throw',
      payload: { version: 1, nodeId: 'plan' },
      availableAt: timestamp,
      createdAt: timestamp,
    })
    const secret = 'must-not-leak'
    const worker = createExecutionWorker({
      workerId: 'worker-01',
      queue,
      runner: {
        run: vi.fn(async () => {
          throw new Error(secret)
        }),
        cancel: vi.fn(async () => ({ status: 'cancelled' })),
      },
      now: () => timestamp,
    })

    expect(await worker.runOnce()).toBe(true)
    const failure = queue.list({ destination: 'COORDINATOR' }).at(-1)
    expect(failure).toMatchObject({
      type: 'NODE_EXECUTION_FAILED',
      payload: {
        code: 'NODE_RUNNER_FAILED',
        message: 'Node runner failed before producing a result',
      },
    })
    expect(JSON.stringify(failure)).not.toContain(secret)
    expect(queue.get('command-throw')).toMatchObject({ status: 'PROCESSED' })
  })

  it('renews the claim while a long-running node is active', async () => {
    const queue = createInMemoryExecutionMessageQueue()
    queue.enqueue({
      id: 'command-renew',
      destination: 'WORKER',
      type: 'EXECUTE_NODE',
      runId: 'run-01',
      nodeExecutionId: 'node-execution-renew',
      attemptId: 'attempt-renew',
      payload: { version: 1, nodeId: 'plan' },
      availableAt: timestamp,
      createdAt: timestamp,
    })
    const renew = vi.spyOn(queue, 'renewClaim')
    const worker = createExecutionWorker({
      workerId: 'worker-01',
      queue,
      leaseDurationMs: 30,
      leaseRenewalMs: 5,
      runner: {
        async run() {
          await new Promise((resolve) => setTimeout(resolve, 18))
          return { status: 'succeeded', outcome: 'done', output: {} }
        },
        async cancel() {
          return { status: 'cancelled' }
        },
      },
      now: () => new Date().toISOString(),
    })

    expect(await worker.runOnce()).toBe(true)
    expect(renew).toHaveBeenCalled()
  })

  it('forwards cancellation to every active runner for a run', async () => {
    const queue = createInMemoryExecutionMessageQueue()
    queue.enqueue({
      id: 'command-cancel',
      destination: 'WORKER',
      type: 'EXECUTE_NODE',
      runId: 'run-01',
      nodeExecutionId: 'node-execution-cancel',
      attemptId: 'attempt-cancel',
      payload: { version: 1, nodeId: 'plan' },
      availableAt: timestamp,
      createdAt: timestamp,
    })
    let finish: ((value: { status: 'cancelled'; reason: string }) => void) | undefined
    const cancel = vi.fn(async () => {
      finish?.({ status: 'cancelled', reason: 'Stopped by user' })
      return { status: 'cancelled' as const }
    })
    const worker = createExecutionWorker({
      workerId: 'worker-01',
      queue,
      runner: {
        run: () =>
          new Promise((resolve) => {
            finish = resolve
          }),
        cancel,
      },
      now: () => timestamp,
    })

    const execution = worker.runOnce()
    await vi.waitFor(() => expect(queue.list({ destination: 'COORDINATOR' })).toHaveLength(1))
    await expect(worker.cancelRun('run-01')).resolves.toEqual({ status: 'cancelled' })
    await execution
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-01', attemptId: 'attempt-cancel' }),
    )
  })
})
