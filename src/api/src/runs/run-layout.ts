import { join } from 'node:path'
import { z } from 'zod'

import type { SlopifyRunPaths } from '../filesystem/slopify-home.js'

const executionIndexSchema = z.number().int().nonnegative().safe()
const nodeExecutionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u)

export interface NodeExecutionPaths {
  readonly directory: string
  readonly executionFile: string
  readonly traceFile: string
}

export const resolveNodeExecutionPaths = (
  runPaths: SlopifyRunPaths,
  executionIndexInput: number,
  nodeExecutionIdInput: string,
): NodeExecutionPaths => {
  const executionIndex = executionIndexSchema.safeParse(executionIndexInput)
  const nodeExecutionId = nodeExecutionIdSchema.safeParse(nodeExecutionIdInput)
  if (!executionIndex.success) throw new TypeError('Execution index is invalid')
  if (!nodeExecutionId.success) throw new TypeError('Node execution ID is invalid')
  const directory = join(runPaths.nodesDirectory, `${executionIndex.data}-${nodeExecutionId.data}`)
  return {
    directory,
    executionFile: join(directory, 'execution.json'),
    traceFile: join(directory, 'trace.jsonl'),
  }
}
