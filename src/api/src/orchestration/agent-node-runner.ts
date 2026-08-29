import { dirname } from 'node:path'

import {
  AgentExecutionIdSchema,
  AgentExecutionInputSchema,
  AgentTraceHeaderSchema,
  RunIdSchema,
  type RunId,
  type AgentExecutionEvent,
  type AgentExecutor,
} from '@slopify/shared'
import { getDeclaredOutcomes, renderPromptVariables, WorkflowSchema } from '@slopify/shared'
import { z } from 'zod'

import type { HarnessCatalog } from '../modules/harness/harness-catalog.js'
import type { JsonValue } from '../json-value.js'
import type { AgentTraceStore } from '../traces/filesystem-agent-trace-store.js'
import {
  RunWorkspaceProvisioningError,
  type ProvisionedRunRepository,
  type RunWorkspaceProvisioner,
} from '../workspaces/run-workspace-provisioner.js'
import type { NodeRunner } from './node-runner.js'

export interface AgentNodeRunRecord {
  readonly runId: RunId
  readonly workflowSnapshot: unknown
  readonly variables: Readonly<Record<string, JsonValue>>
}

export interface RunArtifactDirectory {
  ensure(runId: RunId): Promise<string>
}

const failed = (code: string, message: string) => ({
  status: 'failed' as const,
  code,
  message,
})

const configuredRepositoriesPrompt = (
  repositories: readonly ProvisionedRunRepository[],
): string => {
  const locations = repositories
    .map(
      (repository) =>
        `- ${repository.isPrimary ? 'Primary repository — ' : ''}${repository.name} (${repository.provider} ${repository.fullName})\n  Workspace: ${repository.workspacePath}\n  Branch: ${repository.branchName}\n  Base: ${repository.defaultBranch} at ${repository.baseSha}`,
    )
    .join('\n')
  return `\n\nWorkflow repositories:\nStart in the primary repository. Every path below is a fresh per-run clone shared by this workflow's agents. Work only in these workspaces. Changes made by an earlier agent remain on the shared run branch for later agents. Slopify will not push branches or create pull requests; do that yourself when the task requires it.\n${locations}`
}

const workspaceContext = (
  repositories: readonly ProvisionedRunRepository[],
):
  | Readonly<{
      rootPath: string
      primary: ProvisionedRunRepository
    }>
  | undefined => {
  const primary = repositories.find(({ isPrimary }) => isPrimary)
  if (primary === undefined || repositories.filter(({ isPrimary }) => isPrimary).length !== 1)
    return undefined
  const rootPath = dirname(primary.workspacePath)
  if (repositories.some(({ workspacePath }) => dirname(workspacePath) !== rootPath))
    return undefined
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
    artifacts: RunArtifactDirectory
    workspaces: RunWorkspaceProvisioner
    runs: Readonly<{ get(runId: string): AgentNodeRunRecord | undefined }>
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
        { fresh: true },
      )
    } catch (cause) {
      return harnessFailure(cause)
    }

    let repositories: readonly ProvisionedRunRepository[]
    try {
      repositories = await options.workspaces.ensure(run.runId)
    } catch (cause) {
      if (cause instanceof RunWorkspaceProvisioningError) {
        return failed(cause.code, cause.failures[0]?.message ?? cause.message)
      }
      return failed(
        'RUN_WORKSPACE_PROVISIONING_FAILED',
        'Run repository workspaces could not be prepared',
      )
    }
    const context = workspaceContext(repositories)
    if (context === undefined)
      return failed('RUN_WORKSPACE_INVALID', 'Run repository workspaces are invalid')
    const configuredIds = workflow.data.configuration.repositoryIds
    if (
      repositories.length !== configuredIds.length ||
      repositories.some((repository, index) => repository.repositoryId !== configuredIds[index]) ||
      context.primary.repositoryId !== workflow.data.configuration.primaryRepositoryId
    ) {
      return failed('RUN_WORKSPACE_INVALID', 'Run repository workspaces do not match the workflow')
    }

    let artifactsPath: string
    try {
      artifactsPath = await options.artifacts.ensure(run.runId)
    } catch {
      return failed('RUN_ARTIFACTS_INVALID', 'Run artifacts directory is invalid')
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
      )}${configuredRepositoriesPrompt(repositories)}\n\nShared artifacts: ${artifactsPath}\nUse this directory for run-scoped handoff files. It is outside the repositories and is not committed with repository changes.\n\nExecution contract:\nFinish exactly once using the configured harness completion protocol.\nDeclared outcomes: ${declaredOutcomes.join(', ')}\nProvide a concise summary, JSON data, and evidence.`
      z.string().min(1).max(1_000_000).parse(renderedPrompt)
    } catch {
      return failed('AGENT_PROMPT_INVALID', 'Agent prompt is invalid')
    }

    const executionInput = AgentExecutionInputSchema.parse({
      executionId: input.nodeExecutionId,
      runId: run.runId,
      nodeId: node.id,
      artifactsPath,
      workspace: {
        rootPath: context.rootPath,
        primaryRepositoryId: context.primary.repositoryId,
        repositories: repositories.map((repository) => ({
          repositoryId: repository.repositoryId,
          path: repository.workspacePath,
        })),
      },
      ...(node.harness.modelId === undefined ? {} : { model: node.harness.modelId }),
      ...(node.harness.thinkingLevel === undefined
        ? {}
        : { thinkingLevel: node.harness.thinkingLevel }),
      renderedPrompt,
      declaredOutcomes,
      timeoutSeconds: node.timeoutSeconds,
    })
    const traceHeader = AgentTraceHeaderSchema.parse({
      version: 4,
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
        artifactsPath,
        workspaceRoot: context.rootPath,
        primaryRepositoryId: context.primary.repositoryId,
        repositories: repositories.map((repository) => ({
          repositoryId: repository.repositoryId,
          name: repository.name,
          provider: repository.provider,
          fullName: repository.fullName,
          workspacePath: repository.workspacePath,
          branchName: repository.branchName,
          baseSha: repository.baseSha,
          defaultBranch: repository.defaultBranch,
        })),
        timeoutSeconds: node.timeoutSeconds,
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
