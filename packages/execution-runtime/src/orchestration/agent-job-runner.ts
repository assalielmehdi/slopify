import {
  AgentExecutionIdSchema,
  AgentExecutionInputSchema,
  type AgentExecutionEvent,
  type AgentExecutor,
} from '@loop/agent-runtimes'
import { RunIdSchema } from '@loop/contracts'
import { getDeclaredOutcomes, renderPromptVariables, WorkflowSchema } from '@loop/workflow-model'
import { z } from 'zod'

import type { RunRepository } from '../persistence/run-repository.js'
import type { JobRunner } from './execution-worker.js'

export interface AgentInferenceResolution {
  readonly provider: string
}

export interface AgentResultSchemaRegistry {
  parse(
    schemaRef: string,
    value: unknown,
  ): Readonly<{ success: true; data: unknown }> | Readonly<{ success: false }>
}

export const createAgentResultSchemaRegistry = (
  schemas: Readonly<Record<string, z.ZodType>>,
): AgentResultSchemaRegistry => {
  const registered = new Map(Object.entries(schemas))
  return {
    parse(schemaRef, value) {
      const schema = registered.get(schemaRef)
      if (schema === undefined) return { success: false }
      const result = schema.safeParse(value)
      return result.success ? { success: true, data: result.data } : { success: false }
    },
  }
}

const failed = (code: string, message: string) => ({
  status: 'failed' as const,
  code,
  message,
  retryable: false,
})

export const createAgentJobRunner = (
  options: Readonly<{
    agent: AgentExecutor
    runs: Pick<RunRepository, 'get'>
    resultSchemas: AgentResultSchemaRegistry
    resolveInference(connectionId: string): AgentInferenceResolution | undefined
  }>,
): JobRunner => ({
  async run(input, publishProgress) {
    const run = options.runs.get(RunIdSchema.parse(input.runId))
    if (run === undefined) return failed('RUN_NOT_FOUND', 'Run was not found')
    const workflow = WorkflowSchema.safeParse(run.workflowSnapshot)
    if (!workflow.success) return failed('WORKFLOW_INVALID', 'Effective workflow is invalid')
    const node = workflow.data.nodes.find(({ id }) => id === input.nodeId)
    if (node?.type !== 'agent') return failed('AGENT_JOB_NOT_FOUND', 'Agent job was not found')
    const inference = options.resolveInference(node.job.inference.connectionId)
    if (inference === undefined)
      return failed('INFERENCE_CONNECTION_UNAVAILABLE', 'Inference connection is unavailable')
    const routableOutcomes = getDeclaredOutcomes(workflow.data, node.id)
    const declaredOutcomes =
      routableOutcomes.length === 0 ? (['completed'] as const) : routableOutcomes
    let renderedPrompt: string
    try {
      renderedPrompt = `${renderPromptVariables(node.job.prompt, run.variables)}\n\nExecution contract:\nYou must finish by calling complete_node exactly once.\nDeclared outcomes: ${declaredOutcomes.join(', ')}\nProvide a concise summary, JSON data, and arrays for artifacts and evidence.`
      z.string().min(1).max(1_000_000).parse(renderedPrompt)
    } catch {
      return failed('AGENT_PROMPT_INVALID', 'Agent prompt is invalid')
    }
    const executionInput = AgentExecutionInputSchema.parse({
      executionId: input.nodeExecutionId,
      runId: run.runId,
      nodeId: node.id,
      workspace: {
        rootPath: '/',
        repositories: [],
      },
      provider: inference.provider,
      model: node.job.inference.modelId,
      thinkingLevel: node.job.inference.thinkingLevel,
      permissionProfile: 'workspace-write',
      renderedPrompt,
      declaredOutcomes,
      resourceBundleId: 'execution-skills',
      timeoutSeconds: node.timeoutSeconds,
    })
    let terminal:
      | Readonly<{
          status: 'succeeded'
          event: Extract<AgentExecutionEvent, { type: 'AGENT_RESULT' }>
        }>
      | Readonly<{ status: 'failed'; code: string; message: string }>
      | Readonly<{ status: 'cancelled'; reason: string }>
      | undefined
    for await (const event of options.agent.execute(executionInput)) {
      if (event.type === 'AGENT_RESULT') {
        if (terminal !== undefined)
          return failed('AGENT_RESULT_INVALID', 'Agent produced more than one terminal result')
        terminal = { status: 'succeeded', event }
      } else if (event.type === 'AGENT_FAILED') {
        terminal = { status: 'failed', code: event.data.code, message: event.data.message }
      } else if (event.type === 'AGENT_CANCELLED') {
        terminal = { status: 'cancelled', reason: event.data.reason }
      } else {
        await publishProgress({ eventType: event.type, data: event.data })
      }
    }
    if (terminal === undefined)
      return failed('AGENT_RESULT_MISSING', 'Agent did not produce a terminal result')
    if (terminal.status === 'failed') return failed(terminal.code, terminal.message)
    if (terminal.status === 'cancelled') return terminal
    const { result, usage, durationMs } = terminal.event.data
    const validatedData = options.resultSchemas.parse(node.result.schemaRef, result.data)
    if (!validatedData.success)
      return failed(
        'AGENT_RESULT_SCHEMA_INVALID',
        'Agent result does not satisfy the declared schema',
      )
    return {
      status: 'succeeded',
      outcome: result.outcome,
      output: z.json().parse({
        summary: result.summary,
        data: validatedData.data,
        artifacts: result.artifacts,
        evidence: result.evidence,
        usage,
        durationMs,
      }),
      artifactIds: [],
    }
  },
  cancel(input) {
    return options.agent.cancel(AgentExecutionIdSchema.parse(input.nodeExecutionId))
  },
})
