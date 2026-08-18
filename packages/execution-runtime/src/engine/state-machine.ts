import {
  ArtifactIdSchema,
  OutcomeNameSchema,
  type NodeExecutionStatus,
  type RunStatus,
} from '@loop/contracts'
import type { WorkflowEdge, WorkflowRevision } from '@loop/workflow-model'
import { z } from 'zod'

export type EngineErrorCode =
  | 'EDGE_AMBIGUOUS'
  | 'EDGE_MISSING'
  | 'EXECUTOR_FAILED'
  | 'EXECUTOR_NOT_REGISTERED'
  | 'EXECUTOR_RESULT_INVALID'
  | 'EXECUTOR_TIMEOUT'
  | 'INVALID_STATE_TRANSITION'
  | 'OUTCOME_UNDECLARED'
  | 'RUN_NOT_FOUND'
  | 'RUN_STATE_CONFLICT'
  | 'TRANSITION_LIMIT_EXCEEDED'
  | 'WORKFLOW_INVALID'
  | 'WORKFLOW_NOT_FOUND'

export class EngineError extends Error {
  readonly code: EngineErrorCode
  readonly details?: Readonly<Record<string, unknown>>

  constructor(input: {
    readonly code: EngineErrorCode
    readonly message: string
    readonly details?: Readonly<Record<string, unknown>>
    readonly cause?: unknown
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'EngineError'
    this.code = input.code
    if (input.details !== undefined) this.details = input.details
  }
}

export const NodeResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('succeeded'),
    outcome: OutcomeNameSchema,
    artifactIds: z.array(ArtifactIdSchema).max(32).readonly(),
    output: z.json(),
  }),
  z.strictObject({
    status: z.literal('failed'),
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string().trim().min(1).max(4_096),
  }),
  z.strictObject({
    status: z.literal('cancelled'),
    reason: z.string().trim().min(1).max(1_024),
  }),
])

export type NodeResult = z.infer<typeof NodeResultSchema>

export const parseNodeResult = (value: unknown): NodeResult => {
  const result = NodeResultSchema.safeParse(value)
  if (!result.success) {
    throw new EngineError({
      code: 'EXECUTOR_RESULT_INVALID',
      message: 'Executor returned an invalid structured result',
      details: {
        issues: result.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path,
        })),
      },
    })
  }
  return result.data
}

type ExecutableNode = Exclude<WorkflowRevision['nodes'][number], { readonly type: 'terminal' }>

export const resolveNextEdge = (
  workflow: WorkflowRevision,
  node: ExecutableNode,
  outcomeInput: string,
): WorkflowEdge => {
  const outcome = OutcomeNameSchema.parse(outcomeInput)
  if (!node.outcomes.includes(outcome)) {
    throw new EngineError({
      code: 'OUTCOME_UNDECLARED',
      message: 'Executor returned an outcome that the node does not declare',
      details: { nodeId: node.id, outcome },
    })
  }

  const edges = workflow.edges.filter(
    (edge) => edge.sourceNodeId === node.id && edge.outcome === outcome,
  )
  if (edges.length === 0) {
    throw new EngineError({
      code: 'EDGE_MISSING',
      message: 'No workflow edge matches the declared node outcome',
      details: { nodeId: node.id, outcome },
    })
  }
  if (edges.length > 1) {
    throw new EngineError({
      code: 'EDGE_AMBIGUOUS',
      message: 'Multiple workflow edges match the declared node outcome',
      details: { nodeId: node.id, outcome },
    })
  }

  return edges[0] as WorkflowEdge
}

const RUN_TRANSITIONS: Readonly<Record<RunStatus, ReadonlySet<RunStatus>>> = {
  PENDING: new Set(['RUNNING', 'FAILED', 'CANCELLED']),
  RUNNING: new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']),
  SUCCEEDED: new Set(),
  FAILED: new Set(),
  CANCELLED: new Set(),
  INTERRUPTED: new Set(),
}

const NODE_TRANSITIONS: Readonly<Record<NodeExecutionStatus, ReadonlySet<NodeExecutionStatus>>> = {
  PENDING: new Set(['RUNNING', 'SKIPPED']),
  RUNNING: new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']),
  SUCCEEDED: new Set(),
  FAILED: new Set(),
  CANCELLED: new Set(),
  SKIPPED: new Set(),
}

export const isRunTransitionAllowed = (from: RunStatus, to: RunStatus): boolean =>
  RUN_TRANSITIONS[from].has(to)

export const isNodeTransitionAllowed = (
  from: NodeExecutionStatus,
  to: NodeExecutionStatus,
): boolean => NODE_TRANSITIONS[from].has(to)
