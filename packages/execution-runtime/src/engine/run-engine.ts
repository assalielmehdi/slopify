import { RunIdSchema, type NodeId, type RunId } from '@loop/contracts'
import { validateWorkflow, type WorkflowRevision } from '@loop/workflow-model'

import type { ExecutorRegistry, NodeExecutor } from '../executors/registry.js'
import type { RunRecord, RunRepository } from '../persistence/run-repository.js'
import type { WorkflowRepository } from '../persistence/workflow-repository.js'
import {
  EngineError,
  parseNodeResult,
  resolveNextEdge,
  type EngineErrorCode,
} from './state-machine.js'

export interface EngineFailure {
  readonly code: EngineErrorCode
  readonly message: string
  readonly nodeId?: NodeId
}

export type RunEngineResult =
  | Readonly<{ status: 'completed'; run: RunRecord }>
  | Readonly<{ status: 'cancelled'; run: RunRecord }>
  | Readonly<{ status: 'failed'; run: RunRecord; failure: EngineFailure }>

export interface RunEngine {
  execute(runId: RunId): Promise<RunEngineResult>
}

export interface CreateRunEngineOptions {
  readonly runs: RunRepository
  readonly workflows: WorkflowRepository
  readonly executors: ExecutorRegistry
  readonly now?: () => number
  readonly createNodeExecutionId?: () => string
  readonly resolveTimeoutMs?: (
    node: Exclude<WorkflowRevision['nodes'][number], { readonly type: 'terminal' }>,
  ) => number
}

type ExecutorAttempt =
  | Readonly<{ status: 'returned'; value: unknown }>
  | Readonly<{ status: 'threw'; cause: unknown }>
  | Readonly<{ status: 'timed-out' }>

const executeWithTimeout = async (input: {
  readonly executor: NodeExecutor
  readonly context: Parameters<NodeExecutor['execute']>[0]
  readonly timeoutMs: number
  readonly controller: AbortController
}): Promise<ExecutorAttempt> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const execution: Promise<ExecutorAttempt> = Promise.resolve().then(async () => {
    try {
      return { status: 'returned', value: await input.executor.execute(input.context) }
    } catch (cause) {
      return { status: 'threw', cause }
    }
  })
  const timedOut = new Promise<ExecutorAttempt>((resolve) => {
    timeout = setTimeout(() => {
      input.controller.abort()
      resolve({ status: 'timed-out' })
    }, input.timeoutMs)
  })

  try {
    return await Promise.race([execution, timedOut])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

const timestamp = (milliseconds: number): string => new Date(milliseconds).toISOString()
const elapsed = (startedAt: number, completedAt: number): number =>
  Math.max(0, completedAt - startedAt)

export const createRunEngine = (options: CreateRunEngineOptions): RunEngine => {
  const now = options.now ?? Date.now
  const createNodeExecutionId =
    options.createNodeExecutionId ?? (() => `node-execution-${crypto.randomUUID()}`)
  const resolveTimeoutMs =
    options.resolveTimeoutMs ??
    ((node) => (node.type === 'router' ? 60_000 : node.timeoutSeconds * 1_000))

  return {
    async execute(runIdInput) {
      const runId = RunIdSchema.parse(runIdInput)
      const initialRun = options.runs.get(runId)
      if (initialRun === undefined) {
        throw new EngineError({ code: 'RUN_NOT_FOUND', message: 'Run was not found' })
      }
      if (initialRun.status !== 'PENDING') {
        throw new EngineError({
          code: 'RUN_STATE_CONFLICT',
          message: 'Only a pending run can begin execution',
          details: { runId, status: initialRun.status },
        })
      }

      const runStartedAt = now()
      const workflow = options.workflows.getRevision({
        workflowId: initialRun.workflowId,
        revisionId: initialRun.revisionId,
      })
      if (workflow === undefined) {
        const completedAt = now()
        const run = options.runs.completeRun({
          runId,
          expectedStatus: 'PENDING',
          status: 'FAILED',
          durationMs: elapsed(runStartedAt, completedAt),
          timestamp: timestamp(completedAt),
        })
        return {
          status: 'failed',
          run,
          failure: { code: 'WORKFLOW_NOT_FOUND', message: 'Workflow revision was not found' },
        }
      }

      const validation = validateWorkflow(workflow, {
        registeredCommandIds: options.executors.registeredCommandIds,
      })
      if (!validation.valid) {
        const completedAt = now()
        const run = options.runs.completeRun({
          runId,
          expectedStatus: 'PENDING',
          status: 'FAILED',
          durationMs: elapsed(runStartedAt, completedAt),
          timestamp: timestamp(completedAt),
        })
        return {
          status: 'failed',
          run,
          failure: { code: 'WORKFLOW_INVALID', message: 'Workflow revision is not executable' },
        }
      }

      options.runs.changeStatus({
        runId,
        expectedStatus: 'PENDING',
        status: 'RUNNING',
        timestamp: timestamp(runStartedAt),
      })
      let nodeId: NodeId = workflow.startNodeId

      while (true) {
        const node = workflow.nodes.find((candidate) => candidate.id === nodeId)
        if (node === undefined) {
          throw new EngineError({
            code: 'WORKFLOW_INVALID',
            message: 'Current workflow node was not found',
            details: { nodeId },
          })
        }

        if (node.type === 'terminal') {
          const completedAt = now()
          const run = options.runs.completeRun({
            runId,
            expectedStatus: 'RUNNING',
            status: node.terminalStatus,
            durationMs: elapsed(runStartedAt, completedAt),
            timestamp: timestamp(completedAt),
          })
          return { status: 'completed', run }
        }

        const currentRun = options.runs.get(runId)
        if (currentRun === undefined) {
          throw new EngineError({ code: 'RUN_NOT_FOUND', message: 'Run was not found' })
        }
        const nodeExecutionId = createNodeExecutionId()
        const nodeStartedAt = now()
        options.runs.startNode({
          runId,
          nodeExecutionId,
          nodeId: node.id,
          inputReferences: [],
          timestamp: timestamp(nodeStartedAt),
        })

        const fail = (
          failure: EngineFailure,
          nodeFailure: { readonly code: string; readonly message: string } = failure,
        ): RunEngineResult => {
          const completedAt = now()
          const run = options.runs.failNodeAndRun({
            runId,
            nodeExecutionId,
            nodeId: node.id,
            nodeStatus: 'FAILED',
            runStatus: 'FAILED',
            code: nodeFailure.code,
            message: nodeFailure.message,
            nodeDurationMs: elapsed(nodeStartedAt, completedAt),
            runDurationMs: elapsed(runStartedAt, completedAt),
            timestamp: timestamp(completedAt),
          })
          return { status: 'failed', run, failure }
        }

        const executor = options.executors.resolve(node)
        if (executor === undefined) {
          return fail({
            code: 'EXECUTOR_NOT_REGISTERED',
            message: 'No executor is registered for the workflow node',
            nodeId: node.id,
          })
        }

        const timeoutMs = resolveTimeoutMs(node)
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
          return fail({
            code: 'WORKFLOW_INVALID',
            message: 'Node timeout is outside the supported range',
            nodeId: node.id,
          })
        }
        const controller = new AbortController()
        const attempt = await executeWithTimeout({
          executor,
          context: {
            run: currentRun,
            workflow,
            node,
            nodeExecutionId,
            signal: controller.signal,
          },
          timeoutMs,
          controller,
        })
        if (attempt.status === 'timed-out') {
          return fail({
            code: 'EXECUTOR_TIMEOUT',
            message: 'Node executor exceeded its configured timeout',
            nodeId: node.id,
          })
        }
        if (attempt.status === 'threw') {
          return fail({
            code: 'EXECUTOR_FAILED',
            message: 'Node executor failed before producing a result',
            nodeId: node.id,
          })
        }

        let result
        try {
          result = parseNodeResult(attempt.value)
        } catch (cause) {
          if (cause instanceof EngineError) {
            return fail({ code: cause.code, message: cause.message, nodeId: node.id })
          }
          throw cause
        }
        if (result.status === 'failed') {
          return fail(
            {
              code: 'EXECUTOR_FAILED',
              message: result.message,
              nodeId: node.id,
            },
            { code: result.code, message: result.message },
          )
        }
        if (result.status === 'cancelled') {
          const completedAt = now()
          const run = options.runs.failNodeAndRun({
            runId,
            nodeExecutionId,
            nodeId: node.id,
            nodeStatus: 'CANCELLED',
            runStatus: 'CANCELLED',
            code: 'EXECUTOR_CANCELLED',
            message: result.reason,
            nodeDurationMs: elapsed(nodeStartedAt, completedAt),
            runDurationMs: elapsed(runStartedAt, completedAt),
            timestamp: timestamp(completedAt),
          })
          return { status: 'cancelled', run }
        }

        let edge
        try {
          edge = resolveNextEdge(workflow, node, result.outcome)
        } catch (cause) {
          if (cause instanceof EngineError) {
            return fail({ code: cause.code, message: cause.message, nodeId: node.id })
          }
          throw cause
        }
        if (currentRun.transitionCount >= workflow.maxTransitions) {
          return fail({
            code: 'TRANSITION_LIMIT_EXCEEDED',
            message: 'Workflow transition limit was reached before selecting the next edge',
            nodeId: node.id,
          })
        }

        const nodeCompletedAt = now()
        options.runs.completeNodeAndSelectEdge({
          runId,
          nodeExecutionId,
          nodeId: node.id,
          outcome: result.outcome,
          durationMs: elapsed(nodeStartedAt, nodeCompletedAt),
          artifactIds: result.artifactIds,
          output: result.output,
          targetNodeId: edge.targetNodeId,
          timestamp: timestamp(nodeCompletedAt),
        })
        nodeId = edge.targetNodeId
      }
    },
  }
}
