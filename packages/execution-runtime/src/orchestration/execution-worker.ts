import {
  ExecuteNodePayloadSchema,
  type ExecutionMessageQueue,
  type NewExecutionMessage,
} from './execution-messages.js'

export interface NodeRunInput {
  readonly runId: string
  readonly nodeExecutionId: string
  readonly attemptId: string
  readonly nodeId: string
}

export type NodeRunResult =
  | Readonly<{
      status: 'succeeded'
      outcome: string
      output: unknown
    }>
  | Readonly<{
      status: 'failed'
      code: string
      message: string
    }>
  | Readonly<{ status: 'cancelled'; reason: string }>

export interface NodeRunner {
  run(input: NodeRunInput): Promise<NodeRunResult>
  cancel(input: NodeRunInput): Promise<Readonly<{ status: 'cancelled' | 'unconfirmed' }>>
}

export interface ExecutionWorker {
  runOnce(): Promise<boolean>
  drain(): Promise<number>
  cancelRun(runId: string): Promise<Readonly<{ status: 'cancelled' | 'unconfirmed' }>>
  shutdown(): Promise<Readonly<{ status: 'cancelled' | 'unconfirmed' }>>
  executingRunIds(): readonly string[]
}

const validConcurrency = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 32)
    throw new TypeError('Worker concurrency is invalid')
  return value
}

export const createExecutionWorker = (
  options: Readonly<{
    workerId: string
    queue: ExecutionMessageQueue
    runner: NodeRunner
    concurrency?: number
    leaseDurationMs?: number
    leaseRenewalMs?: number
    now?: () => string
    createMessageId?: () => string
  }>,
): ExecutionWorker => {
  const concurrency = validConcurrency(options.concurrency ?? 2)
  const leaseDurationMs = options.leaseDurationMs ?? 30_000
  const leaseRenewalMs = options.leaseRenewalMs ?? Math.max(1, Math.floor(leaseDurationMs / 3))
  if (
    !Number.isSafeInteger(leaseRenewalMs) ||
    leaseRenewalMs < 1 ||
    leaseRenewalMs >= leaseDurationMs
  ) {
    throw new TypeError('Lease renewal cadence is invalid')
  }
  const now = options.now ?? (() => new Date().toISOString())
  const createMessageId = options.createMessageId ?? (() => `message-${crypto.randomUUID()}`)
  const active = new Map<string, Readonly<{ input: NodeRunInput; runner: NodeRunner }>>()

  const runOnce = async (): Promise<boolean> => {
    const command = options.queue.claimNext({
      destination: 'WORKER',
      consumerId: options.workerId,
      now: now(),
      leaseDurationMs,
    })
    if (command === undefined) return false
    const payload = ExecuteNodePayloadSchema.parse(command.payload)
    const input: NodeRunInput = {
      runId: command.runId,
      nodeExecutionId: command.nodeExecutionId,
      attemptId: command.attemptId,
      nodeId: payload.nodeId,
    }
    const startedAt = now()
    options.queue.enqueue({
      id: createMessageId(),
      destination: 'COORDINATOR',
      type: 'NODE_EXECUTION_STARTED',
      runId: command.runId,
      nodeExecutionId: command.nodeExecutionId,
      attemptId: command.attemptId,
      payload: { version: 1, startedAt },
      availableAt: startedAt,
      createdAt: startedAt,
    })
    const runner = options.runner
    let renewal: ReturnType<typeof setInterval> | undefined
    let result: NodeRunResult
    try {
      active.set(command.id, { input, runner })
      renewal = setInterval(() => {
        options.queue.renewClaim({
          messageId: command.id,
          consumerId: options.workerId,
          now: now(),
          leaseDurationMs,
        })
      }, leaseRenewalMs)
      result = await runner.run(input)
    } catch {
      result = {
        status: 'failed',
        code: 'NODE_RUNNER_FAILED',
        message: 'Node runner failed before producing a result',
      }
    } finally {
      if (renewal !== undefined) clearInterval(renewal)
      active.delete(command.id)
    }
    const completedAt = now()
    const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt))
    let terminal: NewExecutionMessage
    if (result.status === 'succeeded') {
      terminal = {
        id: createMessageId(),
        destination: 'COORDINATOR',
        type: 'NODE_EXECUTION_SUCCEEDED',
        runId: command.runId,
        nodeExecutionId: command.nodeExecutionId,
        attemptId: command.attemptId,
        payload: {
          version: 1,
          outcome: result.outcome,
          output: JSON.parse(JSON.stringify(result.output)) as never,
          completedAt,
          durationMs,
        },
        availableAt: completedAt,
        createdAt: completedAt,
      }
    } else if (result.status === 'cancelled') {
      terminal = {
        id: createMessageId(),
        destination: 'COORDINATOR',
        type: 'NODE_EXECUTION_CANCELLED',
        runId: command.runId,
        nodeExecutionId: command.nodeExecutionId,
        attemptId: command.attemptId,
        payload: { version: 1, reason: result.reason, completedAt, durationMs },
        availableAt: completedAt,
        createdAt: completedAt,
      }
    } else {
      terminal = {
        id: createMessageId(),
        destination: 'COORDINATOR',
        type: 'NODE_EXECUTION_FAILED',
        runId: command.runId,
        nodeExecutionId: command.nodeExecutionId,
        attemptId: command.attemptId,
        payload: {
          version: 1,
          code: result.code,
          message: result.message,
          completedAt,
          durationMs,
        },
        availableAt: completedAt,
        createdAt: completedAt,
      }
    }
    options.queue.completeClaim({
      messageId: command.id,
      consumerId: options.workerId,
      processedAt: completedAt,
      emitted: [terminal],
    })
    return true
  }

  const cancel = async (
    entries: readonly Readonly<{ input: NodeRunInput; runner: NodeRunner }>[],
  ): Promise<Readonly<{ status: 'cancelled' | 'unconfirmed' }>> => {
    if (entries.length === 0) return { status: 'unconfirmed' }
    const results = await Promise.all(
      entries.map(async ({ input, runner }) => {
        try {
          return await runner.cancel(input)
        } catch {
          return { status: 'unconfirmed' as const }
        }
      }),
    )
    return results.every(({ status }) => status === 'cancelled')
      ? { status: 'cancelled' }
      : { status: 'unconfirmed' }
  }

  return {
    runOnce,
    async drain() {
      let processed = 0
      while (true) {
        const batch = await Promise.all(Array.from({ length: concurrency }, runOnce))
        const count = batch.filter(Boolean).length
        processed += count
        if (count === 0) return processed
      }
    },
    cancelRun(runId) {
      return cancel([...active.values()].filter(({ input }) => input.runId === runId))
    },
    shutdown() {
      return cancel([...active.values()])
    },
    executingRunIds() {
      return [...new Set([...active.values()].map(({ input }) => input.runId))]
    },
  }
}
