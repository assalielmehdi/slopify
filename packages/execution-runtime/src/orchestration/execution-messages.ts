import { z } from 'zod'

import type { JsonValue } from '../persistence/json.js'

const identifier = z.string().trim().min(1).max(256)
const timestamp = z.iso.datetime({ offset: true })
const duration = z.number().int().nonnegative().safe()

export const ExecuteNodePayloadSchema = z.strictObject({
  version: z.literal(1),
  nodeId: identifier,
})
export const NodeExecutionStartedPayloadSchema = z.strictObject({
  version: z.literal(1),
  startedAt: timestamp,
})
export const NodeExecutionSucceededPayloadSchema = z.strictObject({
  version: z.literal(1),
  outcome: identifier,
  output: z.json(),
  completedAt: timestamp,
  durationMs: duration,
})
export const NodeExecutionFailedPayloadSchema = z.strictObject({
  version: z.literal(1),
  code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/u)
    .max(128),
  message: z.string().trim().min(1).max(4_096),
  completedAt: timestamp,
  durationMs: duration,
})
export const NodeExecutionCancelledPayloadSchema = z.strictObject({
  version: z.literal(1),
  reason: z.string().trim().min(1).max(1_024),
  completedAt: timestamp,
  durationMs: duration,
})

export const ExecutionMessagePayloadSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('EXECUTE_NODE'), payload: ExecuteNodePayloadSchema }),
  z.strictObject({
    type: z.literal('NODE_EXECUTION_STARTED'),
    payload: NodeExecutionStartedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal('NODE_EXECUTION_SUCCEEDED'),
    payload: NodeExecutionSucceededPayloadSchema,
  }),
  z.strictObject({
    type: z.literal('NODE_EXECUTION_FAILED'),
    payload: NodeExecutionFailedPayloadSchema,
  }),
  z.strictObject({
    type: z.literal('NODE_EXECUTION_CANCELLED'),
    payload: NodeExecutionCancelledPayloadSchema,
  }),
])

export type ExecutionMessageType = z.infer<typeof ExecutionMessagePayloadSchema>['type']
export type ExecutionMessageDestination = 'WORKER' | 'COORDINATOR'
export type ExecutionMessageStatus = 'PENDING' | 'CLAIMED' | 'PROCESSED'

export interface ExecutionMessage {
  readonly id: string
  readonly destination: ExecutionMessageDestination
  readonly type: ExecutionMessageType
  readonly runId: string
  readonly nodeExecutionId: string
  readonly attemptId: string
  readonly payload: JsonValue
  readonly status: ExecutionMessageStatus
  readonly availableAt: string
  readonly claimedBy?: string
  readonly leaseExpiresAt?: string
  readonly attempts: number
  readonly createdAt: string
  readonly processedAt?: string
}

export type NewExecutionMessage = Omit<
  ExecutionMessage,
  'status' | 'claimedBy' | 'leaseExpiresAt' | 'attempts' | 'processedAt'
>

export const decodeExecutionMessagePayload = (
  message: Pick<ExecutionMessage, 'type' | 'payload'>,
) => ExecutionMessagePayloadSchema.parse(message)

export interface ExecutionMessageQueue {
  enqueue(message: NewExecutionMessage): ExecutionMessage
  claimNext(
    input: Readonly<{
      destination: ExecutionMessageDestination
      consumerId: string
      now: string
      leaseDurationMs: number
    }>,
  ): ExecutionMessage | undefined
  renewClaim(
    input: Readonly<{
      messageId: string
      consumerId: string
      now: string
      leaseDurationMs: number
    }>,
  ): boolean
  recoverExpired(
    input: Readonly<{
      destination: ExecutionMessageDestination
      now: string
      retry: boolean
    }>,
  ): readonly string[]
  cancelPendingRunCommands(
    input: Readonly<{
      runId: string
      processedAt: string
    }>,
  ): readonly string[]
  completeClaim(
    input: Readonly<{
      messageId: string
      consumerId: string
      processedAt: string
      emitted: readonly NewExecutionMessage[]
    }>,
  ): void
  get(messageId: string): ExecutionMessage | undefined
  list(
    input?: Readonly<{
      destination?: ExecutionMessageDestination
      status?: ExecutionMessageStatus
    }>,
  ): readonly ExecutionMessage[]
}

const validateNewMessage = (message: NewExecutionMessage): NewExecutionMessage => {
  identifier.parse(message.id)
  identifier.parse(message.runId)
  identifier.parse(message.nodeExecutionId)
  identifier.parse(message.attemptId)
  timestamp.parse(message.availableAt)
  timestamp.parse(message.createdAt)
  ExecutionMessagePayloadSchema.parse({ type: message.type, payload: message.payload })
  const expectedDestination = message.type === 'EXECUTE_NODE' ? 'WORKER' : 'COORDINATOR'
  if (message.destination !== expectedDestination)
    throw new TypeError('Message destination is invalid')
  return message
}

const clone = (message: ExecutionMessage): ExecutionMessage => structuredClone(message)
const expiration = (now: string, leaseDurationMs: number): string => {
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0)
    throw new TypeError('Lease duration is invalid')
  return new Date(Date.parse(timestamp.parse(now)) + leaseDurationMs).toISOString()
}

export const createInMemoryExecutionMessageQueue = (): ExecutionMessageQueue => {
  const messages = new Map<string, ExecutionMessage>()
  return {
    enqueue(unparsed) {
      const message = validateNewMessage(unparsed)
      if (messages.has(message.id)) throw new Error('Execution message already exists')
      const persisted: ExecutionMessage = {
        ...clone(message as ExecutionMessage),
        status: 'PENDING',
        attempts: 0,
      }
      messages.set(persisted.id, persisted)
      return clone(persisted)
    },
    claimNext(input) {
      const leaseExpiresAt = expiration(input.now, input.leaseDurationMs)
      const message = [...messages.values()]
        .filter(
          (candidate) =>
            candidate.destination === input.destination &&
            candidate.status === 'PENDING' &&
            candidate.availableAt <= input.now,
        )
        .sort(
          (left, right) =>
            left.availableAt.localeCompare(right.availableAt) ||
            left.createdAt.localeCompare(right.createdAt),
        )[0]
      if (message === undefined) return undefined
      const claimed: ExecutionMessage = {
        ...message,
        status: 'CLAIMED',
        claimedBy: identifier.parse(input.consumerId),
        leaseExpiresAt,
        attempts: message.attempts + 1,
      }
      messages.set(message.id, claimed)
      return clone(claimed)
    },
    renewClaim(input) {
      const message = messages.get(input.messageId)
      if (message?.status !== 'CLAIMED' || message.claimedBy !== input.consumerId) return false
      messages.set(message.id, {
        ...message,
        leaseExpiresAt: expiration(input.now, input.leaseDurationMs),
      })
      return true
    },
    recoverExpired(input) {
      if (!input.retry) return []
      const recovered = [...messages.values()].filter(
        (message) =>
          message.destination === input.destination &&
          message.status === 'CLAIMED' &&
          message.leaseExpiresAt !== undefined &&
          message.leaseExpiresAt <= input.now,
      )
      for (const message of recovered) {
        messages.set(message.id, {
          id: message.id,
          destination: message.destination,
          type: message.type,
          runId: message.runId,
          nodeExecutionId: message.nodeExecutionId,
          attemptId: message.attemptId,
          payload: message.payload,
          status: 'PENDING',
          availableAt: message.availableAt,
          attempts: message.attempts,
          createdAt: message.createdAt,
        })
      }
      return recovered.map(({ id }) => id)
    },
    cancelPendingRunCommands(input) {
      const processedAt = timestamp.parse(input.processedAt)
      const cancelled = [...messages.values()].filter(
        (message) =>
          message.destination === 'WORKER' &&
          message.runId === input.runId &&
          message.status === 'PENDING',
      )
      for (const message of cancelled)
        messages.set(message.id, { ...message, status: 'PROCESSED', processedAt })
      return cancelled.map(({ id }) => id)
    },
    completeClaim(input) {
      const message = messages.get(input.messageId)
      if (message?.status !== 'CLAIMED' || message.claimedBy !== input.consumerId)
        throw new Error('Execution message claim is not owned by this consumer')
      for (const emitted of input.emitted) {
        validateNewMessage(emitted)
        if (messages.has(emitted.id)) throw new Error('Execution message already exists')
      }
      messages.set(message.id, {
        ...message,
        status: 'PROCESSED',
        processedAt: timestamp.parse(input.processedAt),
      })
      for (const emitted of input.emitted) this.enqueue(emitted)
    },
    get(messageId) {
      const message = messages.get(messageId)
      return message === undefined ? undefined : clone(message)
    },
    list(input = {}) {
      return [...messages.values()]
        .filter(
          (message) =>
            (input.destination === undefined || message.destination === input.destination) &&
            (input.status === undefined || message.status === input.status),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(clone)
    },
  }
}
