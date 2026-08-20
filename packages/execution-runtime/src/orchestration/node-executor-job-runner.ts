import { RunIdSchema } from '@loop/contracts'
import { WorkflowRevisionSchema } from '@loop/workflow-model'

import { parseNodeResult } from '../engine/state-machine.js'
import type { ExecutorRegistry } from '../executors/registry.js'
import type { RunRepository } from '../persistence/run-repository.js'
import type { JobRunner, JobRunResult } from './execution-worker.js'

interface ActiveExecution {
  readonly controller: AbortController
  readonly completion: Promise<JobRunResult>
}

const failed = (code: string, message: string): JobRunResult => ({
  status: 'failed',
  code,
  message,
  retryable: false,
})

export const createNodeExecutorJobRunner = (
  options: Readonly<{
    runs: Pick<RunRepository, 'get'>
    executors: ExecutorRegistry
    cancellationGraceMs?: number
  }>,
): JobRunner => {
  const active = new Map<string, ActiveExecution>()
  const cancellationGraceMs = options.cancellationGraceMs ?? 5_000
  return {
    async run(input) {
      const run = options.runs.get(RunIdSchema.parse(input.runId))
      if (run === undefined) return failed('RUN_NOT_FOUND', 'Run was not found')
      const workflow = WorkflowRevisionSchema.safeParse(run.effectiveConfiguration)
      if (!workflow.success) return failed('WORKFLOW_INVALID', 'Effective workflow is invalid')
      const node = workflow.data.nodes.find(({ id }) => id === input.nodeId)
      if (node === undefined || node.type === 'terminal')
        return failed('JOB_NOT_FOUND', 'Executable job was not found')
      const executor = options.executors.resolve(node)
      if (executor === undefined)
        return failed('JOB_RUNNER_NOT_REGISTERED', 'No executor is registered for this job')
      const controller = new AbortController()
      let resolveCompletion: (result: JobRunResult) => void = () => undefined
      const completion = new Promise<JobRunResult>((resolve) => {
        resolveCompletion = resolve
      })
      active.set(input.nodeExecutionId, { controller, completion })
      let result: JobRunResult
      try {
        const parsed = parseNodeResult(
          await executor.execute({
            run,
            workflow: workflow.data,
            node,
            nodeExecutionId: input.nodeExecutionId,
            signal: controller.signal,
          }),
        )
        result =
          parsed.status === 'failed'
            ? failed(parsed.code, parsed.message)
            : parsed.status === 'cancelled'
              ? parsed
              : { ...parsed, artifactIds: [...parsed.artifactIds] }
      } catch {
        result = failed('JOB_EXECUTOR_FAILED', 'Job executor failed before producing a result')
      } finally {
        active.delete(input.nodeExecutionId)
      }
      resolveCompletion(result)
      return result
    },
    async cancel(input) {
      const execution = active.get(input.nodeExecutionId)
      if (execution === undefined) return { status: 'unconfirmed' }
      execution.controller.abort()
      let timeout: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        execution.completion,
        new Promise<undefined>((resolve) => {
          timeout = setTimeout(() => resolve(undefined), cancellationGraceMs)
        }),
      ])
      if (timeout !== undefined) clearTimeout(timeout)
      return result?.status === 'cancelled' ? { status: 'cancelled' } : { status: 'unconfirmed' }
    },
  }
}
