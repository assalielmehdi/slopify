import {
  ExecuteJobPayloadSchema,
  type ExecutionMessageQueue,
  type NewExecutionMessage,
} from './execution-messages.js'

export interface JobExecutionInput {
  readonly runId: string
  readonly nodeExecutionId: string
  readonly attemptId: string
  readonly nodeId: string
}

export interface JobProgress {
  readonly eventType: string
  readonly data: unknown
}

export type JobRunResult =
  | Readonly<{
      status: 'succeeded'
      outcome: string
      output: unknown
      artifactIds: readonly string[]
    }>
  | Readonly<{
      status: 'failed'
      code: string
      message: string
      retryable: boolean
    }>
  | Readonly<{ status: 'cancelled'; reason: string }>

export interface JobRunner {
  run(
    input: JobExecutionInput,
    publishProgress: (progress: JobProgress) => Promise<void>,
  ): Promise<JobRunResult>
  cancel(input: JobExecutionInput): Promise<Readonly<{ status: 'cancelled' | 'unconfirmed' }>>
}

export interface JobRunnerRegistry {
  resolve(kind: string): JobRunner | undefined
}

export const createJobRunnerRegistry = (
  runners: Readonly<Record<string, JobRunner>>,
): JobRunnerRegistry => {
  const byKind = new Map(Object.entries(runners))
  return { resolve: (kind) => byKind.get(kind) }
}

export interface ExecutionWorker {
  runOnce(): Promise<boolean>
  drain(): Promise<number>
  cancelRun(runId: string): Promise<Readonly<{ status: 'cancelled' | 'unconfirmed' }>>
  shutdown(): Promise<Readonly<{ status: 'cancelled' | 'unconfirmed' }>>
  activeRunIds(): readonly string[]
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
    runners: JobRunnerRegistry
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
  const active = new Map<string, Readonly<{ input: JobExecutionInput; runner: JobRunner }>>()

  const runOnce = async (): Promise<boolean> => {
    const command = options.queue.claimNext({
      destination: 'WORKER',
      consumerId: options.workerId,
      now: now(),
      leaseDurationMs,
    })
    if (command === undefined) return false
    const payload = ExecuteJobPayloadSchema.parse(command.payload)
    const input: JobExecutionInput = {
      runId: command.runId,
      nodeExecutionId: command.nodeExecutionId,
      attemptId: command.attemptId,
      nodeId: payload.nodeId,
    }
    const startedAt = now()
    options.queue.enqueue({
      id: createMessageId(),
      destination: 'COORDINATOR',
      type: 'JOB_STARTED',
      runId: command.runId,
      nodeExecutionId: command.nodeExecutionId,
      attemptId: command.attemptId,
      payload: { version: 1, startedAt },
      availableAt: startedAt,
      createdAt: startedAt,
    })
    const runner = options.runners.resolve(payload.jobKind)
    let renewal: ReturnType<typeof setInterval> | undefined
    let result: JobRunResult
    try {
      if (runner === undefined) {
        result = {
          status: 'failed',
          code: 'JOB_RUNNER_NOT_REGISTERED',
          message: 'No runner is registered for this job kind',
          retryable: false,
        }
      } else {
        active.set(command.id, { input, runner })
        renewal = setInterval(() => {
          options.queue.renewClaim({
            messageId: command.id,
            consumerId: options.workerId,
            now: now(),
            leaseDurationMs,
          })
        }, leaseRenewalMs)
        result = await runner.run(input, async (progress) => {
          const occurredAt = now()
          options.queue.enqueue({
            id: createMessageId(),
            destination: 'COORDINATOR',
            type: 'JOB_PROGRESS',
            runId: command.runId,
            nodeExecutionId: command.nodeExecutionId,
            attemptId: command.attemptId,
            payload: {
              version: 1,
              eventType: progress.eventType,
              data: JSON.parse(JSON.stringify(progress.data)) as never,
              occurredAt,
            },
            availableAt: occurredAt,
            createdAt: occurredAt,
          })
        })
      }
    } catch {
      result = {
        status: 'failed',
        code: 'JOB_RUNNER_FAILED',
        message: 'Job runner failed before producing a result',
        retryable: false,
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
        type: 'JOB_SUCCEEDED',
        runId: command.runId,
        nodeExecutionId: command.nodeExecutionId,
        attemptId: command.attemptId,
        payload: {
          version: 1,
          outcome: result.outcome,
          output: JSON.parse(JSON.stringify(result.output)) as never,
          artifactIds: result.artifactIds,
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
        type: 'JOB_CANCELLED',
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
        type: 'JOB_FAILED',
        runId: command.runId,
        nodeExecutionId: command.nodeExecutionId,
        attemptId: command.attemptId,
        payload: {
          version: 1,
          code: result.code,
          message: result.message,
          retryable: result.retryable,
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
    entries: readonly Readonly<{ input: JobExecutionInput; runner: JobRunner }>[],
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
    activeRunIds() {
      return [...new Set([...active.values()].map(({ input }) => input.runId))]
    },
  }
}
