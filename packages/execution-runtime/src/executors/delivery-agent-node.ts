import { lstat, mkdir, realpath, symlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import {
  AgentExecutionInputSchema,
  renderAgentPrompt,
  type AgentExecutor,
  type LoadedResourceBundle,
} from '@loop/agent-runtimes'
import type { ArtifactType } from '@loop/contracts'

import type { RunRepository, RunWorkspace } from '../persistence/run-repository.js'
import {
  createAgentExecutorAdapter,
  type AgentExecutorAdapterResult,
} from './agent-executor-adapter.js'
import type { NodeExecutionContext } from './registry.js'
import type { DurableArtifactReference } from '../services/artifact-publication.js'

export type SelectedAgentNodeErrorCode =
  | 'SELECTED_NODE_CONTEXT_INVALID'
  | 'SELECTED_NODE_SELECTION_MISMATCH'
  | 'SELECTED_NODE_WORKSPACE_INVALID'

export class SelectedAgentNodeError extends Error {
  override readonly name = 'SelectedAgentNodeError'

  constructor(readonly code: SelectedAgentNodeErrorCode) {
    super(code)
  }
}

export interface SelectedAgentRepository extends RunWorkspace {
  readonly responsibility: string
}

export interface ExecuteSelectedAgentNodeOptions {
  readonly agent: AgentExecutor
  readonly runs: RunRepository
  readonly resourceBundle: LoadedResourceBundle
  readonly selectedWorkspaceRoot: string
}

export interface ExecuteSelectedAgentNodeInput {
  readonly context: NodeExecutionContext
  readonly expectedNodeId: 'plan' | 'implement' | 'fix-findings'
  readonly expectedPermission: 'read-only' | 'workspace-write'
  readonly expectedInputArtifacts: readonly ArtifactType[]
  readonly artifacts: readonly DurableArtifactReference[]
  readonly executionEvidence?: readonly Readonly<{
    kind: 'command' | 'test' | 'file' | 'url' | 'note'
    value: string
  }>[]
  readonly boundaries: readonly string[]
  readonly stopConditions: readonly string[]
}

export interface SelectedAgentNodeExecution {
  readonly result: AgentExecutorAdapterResult
  readonly repositories: readonly SelectedAgentRepository[]
  readonly taskId: string
}

export interface PreparedSelectedAgentWorkspace {
  readonly repositories: readonly SelectedAgentRepository[]
  readonly taskId: string
  readonly rootPath: string
  readonly workspaceRepositories: readonly Readonly<{
    repositoryId: string
    path: string
  }>[]
}

const taskId = (snapshot: unknown): string => {
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    !('taskId' in snapshot) ||
    typeof snapshot.taskId !== 'string' ||
    !/^[a-z0-9]{1,128}$/i.test(snapshot.taskId)
  ) {
    throw new SelectedAgentNodeError('SELECTED_NODE_CONTEXT_INVALID')
  }
  return snapshot.taskId
}

const sameValues = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

const selectedRepositories = (runs: RunRepository, context: NodeExecutionContext) => {
  const selections = runs.listSelections(context.run.runId)
  const workspaces = runs.listWorkspaces(context.run.runId)
  if (
    selections.length === 0 ||
    selections.length !== workspaces.length ||
    selections.some(
      (selection, index) =>
        selection.repositoryId !== workspaces[index]?.repositoryId ||
        selection.profilePosition !== workspaces[index]?.profilePosition,
    )
  ) {
    throw new SelectedAgentNodeError('SELECTED_NODE_SELECTION_MISMATCH')
  }
  return workspaces.map((workspace, index) => ({
    ...workspace,
    responsibility: selections[index]?.responsibility ?? '',
  }))
}

const ensureWorkspaceView = async (
  rootPath: string,
  repositories: readonly SelectedAgentRepository[],
): Promise<readonly Readonly<{ repositoryId: string; path: string }>[]> => {
  await mkdir(rootPath, { recursive: true })
  const result = []
  for (const repository of repositories) {
    const path = join(rootPath, repository.repositoryId)
    try {
      const existing = await lstat(path)
      if (
        !existing.isSymbolicLink() ||
        (await realpath(path)) !== (await realpath(repository.worktreePath))
      ) {
        throw new SelectedAgentNodeError('SELECTED_NODE_WORKSPACE_INVALID')
      }
    } catch (cause) {
      if (cause instanceof SelectedAgentNodeError) throw cause
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new SelectedAgentNodeError('SELECTED_NODE_WORKSPACE_INVALID')
      }
      try {
        await symlink(repository.worktreePath, path, 'dir')
      } catch {
        throw new SelectedAgentNodeError('SELECTED_NODE_WORKSPACE_INVALID')
      }
    }
    result.push({ repositoryId: repository.repositoryId, path })
  }
  return result
}

export const prepareSelectedAgentWorkspace = async (
  options: Pick<ExecuteSelectedAgentNodeOptions, 'runs' | 'selectedWorkspaceRoot'>,
  context: NodeExecutionContext,
): Promise<PreparedSelectedAgentWorkspace> => {
  if (!isAbsolute(options.selectedWorkspaceRoot)) {
    throw new SelectedAgentNodeError('SELECTED_NODE_CONTEXT_INVALID')
  }
  const repositories = selectedRepositories(options.runs, context)
  const canonicalTaskId = taskId(context.run.taskSnapshot)
  const rootPath = join(options.selectedWorkspaceRoot, context.run.runId, 'selected')
  const workspaceRepositories = await ensureWorkspaceView(rootPath, repositories)
  return {
    repositories,
    taskId: canonicalTaskId,
    rootPath,
    workspaceRepositories,
  }
}

export const executeSelectedAgentNode = async (
  options: ExecuteSelectedAgentNodeOptions,
  input: ExecuteSelectedAgentNodeInput,
): Promise<SelectedAgentNodeExecution> => {
  const { context } = input
  if (
    context.node.type !== 'agent' ||
    context.node.id !== input.expectedNodeId ||
    context.node.workspacePolicy !== 'selected-worktrees' ||
    context.node.permissionProfile !== input.expectedPermission ||
    context.node.resourceBundleId !== options.resourceBundle.bundleId ||
    !sameValues(context.node.inputArtifacts, input.expectedInputArtifacts)
  ) {
    throw new SelectedAgentNodeError('SELECTED_NODE_CONTEXT_INVALID')
  }
  const prepared = await prepareSelectedAgentWorkspace(options, context)
  const { repositories, rootPath, workspaceRepositories } = prepared
  const rendered = renderAgentPrompt({
    kind: 'execution',
    templateRevision: context.run.revisionId,
    promptTemplate: context.node.promptTemplate,
    task: {
      reference: context.run.taskReference,
      snapshot: JSON.parse(JSON.stringify(context.run.taskSnapshot)),
    },
    objective: context.node.description,
    boundaries: [...input.boundaries],
    artifacts: input.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      runId: artifact.runId,
      artifactType: artifact.artifactType,
      content: artifact.content,
    })),
    executionEvidence: [...(input.executionEvidence ?? [])],
    stopConditions: [...input.stopConditions],
    completionContract: {
      outcomes: [...context.node.outcomes],
      outputSchemaRef: context.node.outputSchemaRef,
    },
    resourceBundle: {
      bundleId: options.resourceBundle.bundleId,
      applicationVersion: options.resourceBundle.applicationVersion,
      skills: options.resourceBundle.skills.map((skill) => ({ ...skill })),
      promptFragments: options.resourceBundle.promptFragments.map((fragment) => ({
        ...fragment,
      })),
      contextFiles: options.resourceBundle.contextFiles.map((file) => ({ ...file })),
    },
    permissionProfile: input.expectedPermission,
    workspace: {
      policy: 'selected-worktrees',
      repositories: repositories.map((repository, index) => ({
        repositoryId: repository.repositoryId,
        profilePosition: repository.profilePosition,
        worktreePath: workspaceRepositories[index]?.path ?? '',
        baseSha: repository.baseSha,
        targetBranch: repository.targetBranch,
        sourceBranch: repository.sourceBranch,
        responsibility: repository.responsibility,
      })),
    },
  })
  const executionInput = AgentExecutionInputSchema.parse({
    executionId: context.nodeExecutionId,
    runId: context.run.runId,
    nodeId: context.node.id,
    workspace: {
      rootPath,
      repositories: rendered.workspace.repositories.map((repository) => ({
        repositoryId: repository.repositoryId,
        path: repository.worktreePath,
        access: input.expectedPermission,
      })),
    },
    provider: context.node.provider,
    model: context.node.model,
    thinkingLevel: context.node.thinkingLevel,
    permissionProfile: input.expectedPermission,
    renderedPrompt: rendered.renderedPrompt,
    declaredOutcomes: context.node.outcomes,
    resourceBundleId: context.node.resourceBundleId,
    timeoutSeconds: context.node.timeoutSeconds,
  })
  const adapter = createAgentExecutorAdapter({ agent: options.agent, runs: options.runs })
  return {
    result: await adapter.execute(context, executionInput),
    repositories,
    taskId: prepared.taskId,
  }
}
