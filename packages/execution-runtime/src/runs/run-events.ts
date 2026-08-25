import { NodeIdSchema, RepositoryIdSchema, RunIdSchema } from '@slopify/contracts'
import { isAbsolute } from 'node:path'
import { z } from 'zod'

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u)
const errorCode = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/u)
const message = z.string().trim().min(1).max(4_096)
const timestamp = z.iso.datetime({ offset: true })
const durationMs = z.number().int().nonnegative().safe()

const eventFields = {
  schemaVersion: z.literal(1),
  eventId: identifier,
  runId: RunIdSchema,
  sequence: z.number().int().positive().safe(),
  timestamp,
} as const

const runEvent = <Type extends string, Data extends z.ZodType>(type: Type, data: Data) =>
  z.strictObject({ ...eventFields, type: z.literal(type), data })

export const RunDomainEventSchema = z.discriminatedUnion('type', [
  runEvent('RUN_STARTED', z.strictObject({})),
  runEvent('RUN_CANCEL_REQUESTED', z.strictObject({ reason: z.string().trim().min(1).max(1_024) })),
  runEvent('RUN_SUCCEEDED', z.strictObject({})),
  runEvent('RUN_FAILED', z.strictObject({ code: errorCode })),
  runEvent('RUN_CANCELLED', z.strictObject({})),
  runEvent(
    'WORKSPACE_PREPARING',
    z.strictObject({
      repositoryId: RepositoryIdSchema,
      position: z.number().int().nonnegative().safe(),
      workspacePath: z.string().trim().min(1).max(4_096).refine(isAbsolute),
      branchName: z.string().trim().min(1).max(512),
    }),
  ),
  runEvent('WORKSPACE_READY', z.strictObject({ repositoryId: RepositoryIdSchema })),
  runEvent(
    'WORKSPACE_FAILED',
    z.strictObject({ repositoryId: RepositoryIdSchema, errorMessage: message }),
  ),
  runEvent('WORKSPACE_CLEANED', z.strictObject({ repositoryId: RepositoryIdSchema })),
  runEvent(
    'NODE_SCHEDULED',
    z.strictObject({
      nodeExecutionId: identifier,
      attemptId: identifier,
      nodeId: NodeIdSchema,
      executionIndex: z.number().int().nonnegative().safe(),
      causationId: identifier,
    }),
  ),
  runEvent('NODE_STARTED', z.strictObject({ nodeExecutionId: identifier, attemptId: identifier })),
  runEvent(
    'NODE_SUCCEEDED',
    z.strictObject({
      nodeExecutionId: identifier,
      attemptId: identifier,
      outcome: z.string().trim().min(1).max(128),
      output: z.json(),
      durationMs,
    }),
  ),
  runEvent(
    'NODE_FAILED',
    z.strictObject({
      nodeExecutionId: identifier,
      attemptId: identifier,
      code: errorCode,
      message,
      durationMs,
    }),
  ),
  runEvent(
    'NODE_CANCELLED',
    z.strictObject({
      nodeExecutionId: identifier,
      attemptId: identifier,
      reason: z.string().trim().min(1).max(1_024),
      durationMs,
    }),
  ),
  runEvent(
    'NODE_TERMINATION_UNCONFIRMED',
    z.strictObject({
      nodeExecutionId: identifier,
      attemptId: identifier,
      reason: z.string().trim().min(1).max(1_024),
    }),
  ),
  runEvent(
    'ROUTE_TRAVERSED',
    z.strictObject({
      sourceNodeExecutionId: identifier,
      sourceNodeId: NodeIdSchema,
      targetNodeId: NodeIdSchema,
      outcome: z.string().trim().min(1).max(128),
    }),
  ),
  runEvent(
    'JOIN_RELEASED',
    z.strictObject({ targetNodeId: NodeIdSchema, causationId: identifier }),
  ),
])

export type RunDomainEvent = z.infer<typeof RunDomainEventSchema>
