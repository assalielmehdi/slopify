import { dirname } from 'node:path'

import {
  AgentExecutionIdSchema,
  AgentExecutionInputSchema,
  AgentTraceHeaderSchema,
  RunIdSchema,
  type AgentExecutionEvent,
  type AgentExecutor,
} from '@slopify/contracts'
import { getDeclaredOutcomes, renderPromptVariables, WorkflowSchema } from '@slopify/workflow-model'
import { z } from 'zod'

import type { HarnessCatalog } from '../harnesses/harness-catalog.js'
import type { RunRepository } from '../persistence/run-repository.js'
import type { AgentTraceStore } from '../traces/filesystem-agent-trace-store.js'
import {
  RunWorkspaceProvisioningError,
  type ProvisionedRunProject,
  type RunWorkspaceProvisioner,
} from '../workspaces/run-workspace-provisioner.js'
import type { NodeRunner } from './execution-worker.js'

const AGENT_EXECUTION_TIMEOUT_SECONDS = 300

const failed = (code: string, message: string) => ({
  status: 'failed' as const,
  code,
  message,
})

const configuredProjectsPrompt = (projects: readonly ProvisionedRunProject[]): string => {
  const locations = projects
    .map(
      (project) =>
        `- ${project.isPrimary ? 'Primary project — ' : ''}${project.name} (${project.provider} ${project.fullName})\n  Workspace: ${project.workspacePath}\n  Branch: ${project.branchName}\n  Base: ${project.defaultBranch} at ${project.baseSha}`,
    )
    .join('\n')
  return `\n\nWorkflow projects:\nStart in the primary project. Every path below is a fresh per-run clone shared by this workflow's agents. Work only in these workspaces. Changes made by an earlier agent remain on the shared run branch for later agents. Slopify will not push branches or create pull requests; do that yourself when the task requires it.\n${locations}`
}

const workspaceContext = (
  projects: readonly ProvisionedRunProject[],
):
  | Readonly<{
      rootPath: string
      primary: ProvisionedRunProject
    }>
  | undefined => {
  const primary = projects.find(({ isPrimary }) => isPrimary)
  if (primary === undefined || projects.filter(({ isPrimary }) => isPrimary).length !== 1)
    return undefined
  const rootPath = dirname(primary.workspacePath)
  if (projects.some(({ workspacePath }) => dirname(workspacePath) !== rootPath)) return undefined
  return { rootPath, primary }
}

const harnessFailure = (cause: unknown) =>
  failed(
    'HARNESS_UNAVAILABLE',
    cause instanceof Error && cause.message.trim() !== ''
      ? cause.message
      : 'The configured harness is unavailable',
  )

export const createAgentNodeRunner = (
  options: Readonly<{
    harnesses: Pick<HarnessCatalog, 'requireAvailable'>
    resolveHarness(harnessId: string): AgentExecutor | undefined
    workspaces: RunWorkspaceProvisioner
    runs: Pick<RunRepository, 'get'>
    traces?: AgentTraceStore
    now?: () => string
  }>,
): NodeRunner => ({
  async run(input) {
    const run = options.runs.get(RunIdSchema.parse(input.runId))
    if (run === undefined) return failed('RUN_NOT_FOUND', 'Run was not found')
    const workflow = WorkflowSchema.safeParse(run.workflowSnapshot)
    if (!workflow.success) return failed('WORKFLOW_INVALID', 'Effective workflow is invalid')
    const node = workflow.data.nodes.find(({ id }) => id === input.nodeId)
    if (node === undefined) return failed('AGENT_NODE_NOT_FOUND', 'Agent node was not found')

    const agent = options.resolveHarness(node.harness.harnessId)
    if (agent === undefined)
      return failed(
        'HARNESS_EXECUTOR_UNAVAILABLE',
        'No executor is registered for the configured harness',
      )
    let harness
    try {
      harness = await options.harnesses.requireAvailable(
        node.harness.harnessId,
        node.harness.modelId,
        node.harness.thinkingLevel,
      )
    } catch (cause) {
      return harnessFailure(cause)
    }

    let projects: readonly ProvisionedRunProject[]
    try {
      projects = await options.workspaces.ensure(run.runId)
    } catch (cause) {
      if (cause instanceof RunWorkspaceProvisioningError) {
        return failed(cause.code, cause.failures[0]?.message ?? cause.message)
      }
      return failed(
        'RUN_WORKSPACE_PROVISIONING_FAILED',
        'Run project workspaces could not be prepared',
      )
    }
    const context = workspaceContext(projects)
    if (context === undefined)
      return failed('RUN_WORKSPACE_INVALID', 'Run project workspaces are invalid')
    const configuredIds = workflow.data.configuration.projectIds
    if (
      projects.length !== configuredIds.length ||
      projects.some((project, index) => project.projectId !== configuredIds[index]) ||
      context.primary.projectId !== workflow.data.configuration.primaryProjectId
    ) {
      return failed('RUN_WORKSPACE_INVALID', 'Run project workspaces do not match the workflow')
    }

    const routableOutcomes = getDeclaredOutcomes(workflow.data, node.id)
    const declaredOutcomes =
      routableOutcomes.length === 0 ? (['completed'] as const) : routableOutcomes
    let renderedPrompt: string
    try {
      renderedPrompt = `${renderPromptVariables(
        node.prompt,
        workflow.data.configuration.variables,
        run.variables,
      )}${configuredProjectsPrompt(projects)}\n\nExecution contract:\nFinish by calling the Slopify completion tool (slopify_complete_node) exactly once.\nDeclared outcomes: ${declaredOutcomes.join(', ')}\nProvide a concise summary, JSON data, and evidence.`
      z.string().min(1).max(1_000_000).parse(renderedPrompt)
    } catch {
      return failed('AGENT_PROMPT_INVALID', 'Agent prompt is invalid')
    }

    const executionInput = AgentExecutionInputSchema.parse({
      executionId: input.nodeExecutionId,
      runId: run.runId,
      nodeId: node.id,
      workspace: {
        rootPath: context.rootPath,
        primaryProjectId: context.primary.projectId,
        projects: projects.map((project) => ({
          projectId: project.projectId,
          path: project.workspacePath,
        })),
      },
      ...(node.harness.modelId === undefined ? {} : { model: node.harness.modelId }),
      ...(node.harness.thinkingLevel === undefined
        ? {}
        : { thinkingLevel: node.harness.thinkingLevel }),
      renderedPrompt,
      declaredOutcomes,
      timeoutSeconds: AGENT_EXECUTION_TIMEOUT_SECONDS,
    })
    const traceHeader = AgentTraceHeaderSchema.parse({
      version: 2,
      runId: run.runId,
      nodeExecutionId: input.nodeExecutionId,
      attemptId: input.attemptId,
      nodeId: node.id,
      createdAt: (options.now ?? (() => new Date().toISOString()))(),
      configuration: {
        harnessId: harness.harnessId,
        harnessVersion: harness.version,
        ...(node.harness.modelId === undefined ? {} : { model: node.harness.modelId }),
        ...(node.harness.thinkingLevel === undefined
          ? {}
          : { thinkingLevel: node.harness.thinkingLevel }),
        renderedPrompt,
        workspaceRoot: context.rootPath,
        primaryProjectId: context.primary.projectId,
        projects: projects.map((project) => ({
          projectId: project.projectId,
          name: project.name,
          provider: project.provider,
          fullName: project.fullName,
          workspacePath: project.workspacePath,
          branchName: project.branchName,
          baseSha: project.baseSha,
          defaultBranch: project.defaultBranch,
        })),
        timeoutSeconds: AGENT_EXECUTION_TIMEOUT_SECONDS,
      },
    })
    try {
      await options.traces?.start(traceHeader)
    } catch {
      return failed('TRACE_WRITE_FAILED', 'Agent trace could not be created')
    }
    let terminal:
      | Readonly<{
          status: 'succeeded'
          event: Extract<AgentExecutionEvent, { type: 'AGENT_RESULT' }>
        }>
      | Readonly<{ status: 'failed'; code: string; message: string }>
      | Readonly<{ status: 'cancelled'; reason: string }>
      | undefined
    for await (const event of agent.execute(executionInput)) {
      try {
        await options.traces?.append(traceHeader, event)
      } catch {
        await agent.cancel(executionInput.executionId).catch(() => undefined)
        return failed('TRACE_WRITE_FAILED', 'Agent trace could not be written')
      }
      if (event.type === 'AGENT_RESULT') {
        if (terminal !== undefined)
          return failed('AGENT_RESULT_INVALID', 'Agent produced more than one terminal result')
        terminal = { status: 'succeeded', event }
      } else if (event.type === 'AGENT_FAILED') {
        terminal = { status: 'failed', code: event.data.code, message: event.data.message }
      } else if (event.type === 'AGENT_CANCELLED') {
        terminal = { status: 'cancelled', reason: event.data.reason }
      }
    }
    if (terminal === undefined)
      return failed('AGENT_RESULT_MISSING', 'Agent did not produce a terminal result')
    if (terminal.status === 'failed') return failed(terminal.code, terminal.message)
    if (terminal.status === 'cancelled') return terminal
    const { result, usage, durationMs } = terminal.event.data
    return {
      status: 'succeeded',
      outcome: result.outcome,
      output: z.json().parse({
        summary: result.summary,
        data: result.data,
        evidence: result.evidence,
        usage,
        durationMs,
      }),
    }
  },
  async cancel(input) {
    const run = options.runs.get(RunIdSchema.parse(input.runId))
    if (run === undefined) return { status: 'unconfirmed' }
    const workflow = WorkflowSchema.safeParse(run.workflowSnapshot)
    if (!workflow.success) return { status: 'unconfirmed' }
    const node = workflow.data.nodes.find(({ id }) => id === input.nodeId)
    if (node === undefined) return { status: 'unconfirmed' }
    const agent = options.resolveHarness(node.harness.harnessId)
    if (agent === undefined) return { status: 'unconfirmed' }
    return agent.cancel(AgentExecutionIdSchema.parse(input.nodeExecutionId))
  },
})
