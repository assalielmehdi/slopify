import type { AgentExecutor } from '@slopify/contracts'
import {
  createAgentNodeRunner,
  createFilesystemGitRunWorkspaceProvisioner,
  createFilesystemJournalCoordinatorStore,
  createFilesystemRunAdmissionService,
  createFilesystemRunEventFeed,
  createFilesystemRunIndex,
  createFilesystemRunReader,
  createFilesystemRunStore,
  createFilesystemWorkflowStore,
  createJournalCancellationService,
  createJournalExecutionWorker,
  createJournalWorkflowCoordinator,
  createRunFilesystemAgentTraceStore,
  createWorkflowDefinitionService,
  resolveSlopifyPaths,
  type AgentTraceStore,
  type FilesystemRunAdmissionService,
  type FilesystemRunEventFeed,
  type FilesystemRunIndex,
  type FilesystemRunReader,
  type FilesystemRunRepositoryResolution,
  type FilesystemRunWorkspaceProvisioner,
  type HarnessCatalog,
  type JournalCancellationService,
  type JournalExecutionWorker,
  type JournalWorkflowCoordinator,
  type NodeRunner,
  type ProcessRunner,
  type RunAgentTraceStore,
  type RunRecord,
  type RunWorkspaceProvisioner,
  type SlopifyPaths,
  type WorkflowDefinitionService,
  type WorkflowStore,
} from '@slopify/execution-runtime'
import { workflowFileToWorkflow } from '@slopify/workflow-model'

import type { CreateApiAppOptions } from './app.js'

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

export interface CreateFilesystemRuntimeOptions {
  readonly environment?: RuntimeEnvironment
  readonly paths?: SlopifyPaths
  readonly harnesses: HarnessCatalog
  readonly resolveHarness: (harnessId: string) => AgentExecutor | undefined
  readonly resolveRepository: (repositoryId: string) => Promise<FilesystemRunRepositoryResolution>
  readonly processRunner: ProcessRunner
  readonly credentialHelper: string
  readonly now?: () => string
  readonly createRunId?: () => string
  readonly concurrency?: number
}

export interface FilesystemRuntime {
  readonly paths: SlopifyPaths
  readonly workflowStore: WorkflowStore
  readonly workflows: WorkflowDefinitionService
  readonly admissions: FilesystemRunAdmissionService
  readonly index: FilesystemRunIndex
  readonly reader: FilesystemRunReader
  readonly eventFeed: FilesystemRunEventFeed
  readonly traces: RunAgentTraceStore
  readonly workspaces: FilesystemRunWorkspaceProvisioner
  readonly coordinator: JournalWorkflowCoordinator
  readonly worker: JournalExecutionWorker
  readonly cancellation: JournalCancellationService
  readonly api: CreateApiAppOptions
}

const legacyRunRecord = (
  detail: Extract<Awaited<ReturnType<FilesystemRunReader['get']>>, { readonly status: 'READY' }>,
): RunRecord => ({
  runId: detail.run.runId,
  workflowId: detail.run.workflowId,
  workflowSnapshot: workflowFileToWorkflow(detail.workflowSnapshot.workflow),
  variables: detail.variablesSnapshot.values,
  status: detail.run.status,
  transitionCount: detail.run.transitionCount,
  createdAt: detail.run.createdAt,
  startedAt: detail.run.startedAt,
  completedAt: detail.run.completedAt,
})

const createFilesystemNodeRunner = (options: {
  readonly harnesses: HarnessCatalog
  readonly resolveHarness: (harnessId: string) => AgentExecutor | undefined
  readonly reader: FilesystemRunReader
  readonly traces: RunAgentTraceStore
  readonly workspaces: FilesystemRunWorkspaceProvisioner
  readonly now?: () => string
}): NodeRunner => {
  const runner = async (input: Parameters<NodeRunner['run']>[0]) => {
    const detail = await options.reader.get(input.runId)
    if (detail?.status !== 'READY') return undefined
    const execution = detail.executions.find(
      (candidate) =>
        candidate.nodeExecutionId === input.nodeExecutionId &&
        candidate.attemptId === input.attemptId &&
        candidate.nodeId === input.nodeId,
    )
    if (execution === undefined) return undefined
    const locator = { workflowId: detail.run.workflowId, runId: detail.run.runId }
    const record = legacyRunRecord(detail)
    const workspaces: RunWorkspaceProvisioner = {
      async ensure() {
        return (await options.workspaces.ensure(locator)).map((repository) => ({
          repositoryId: repository.repositoryId,
          position: repository.position,
          name: repository.name,
          provider: repository.provider,
          remoteId: repository.remoteId,
          fullName: repository.fullName,
          cloneUrl: repository.cloneUrl,
          defaultBranch: repository.defaultBranch,
          baseSha: repository.baseSha,
          isPrimary: repository.isPrimary,
          workspacePath: repository.workspacePath,
          branchName: repository.branchName,
        }))
      },
      cleanup: () => Promise.resolve(),
    }
    const traces: AgentTraceStore = {
      start(header) {
        return options.traces.start({
          workflowId: locator.workflowId,
          executionIndex: execution.executionIndex,
          header,
        })
      },
      append(header, event) {
        return options.traces.append(
          {
            workflowId: locator.workflowId,
            executionIndex: execution.executionIndex,
            header,
          },
          event,
        )
      },
      read(identity) {
        return options.traces.read({
          ...identity,
          workflowId: locator.workflowId,
          executionIndex: execution.executionIndex,
        })
      },
    }
    return createAgentNodeRunner({
      harnesses: options.harnesses,
      resolveHarness: options.resolveHarness,
      workspaces,
      runs: { get: (runId) => (runId === record.runId ? record : undefined) },
      traces,
      ...(options.now === undefined ? {} : { now: options.now }),
    })
  }

  return {
    async run(input) {
      const nodeRunner = await runner(input)
      if (nodeRunner === undefined) {
        return {
          status: 'failed',
          code: 'RUN_EXECUTION_CONTEXT_NOT_FOUND',
          message: 'Captured run execution context was not found',
        }
      }
      return nodeRunner.run(input)
    },
    async cancel(input) {
      const nodeRunner = await runner(input)
      return nodeRunner === undefined ? { status: 'unconfirmed' } : nodeRunner.cancel(input)
    },
  }
}

export const createFilesystemRuntime = (
  options: CreateFilesystemRuntimeOptions,
): FilesystemRuntime => {
  if (options.paths !== undefined && options.environment !== undefined) {
    throw new TypeError('Filesystem runtime paths must have one source')
  }
  const paths =
    options.paths ??
    resolveSlopifyPaths(
      options.environment === undefined ? {} : { environment: options.environment },
    )
  const workflowStore = createFilesystemWorkflowStore({ paths })
  const workflows = createWorkflowDefinitionService({
    workflows: workflowStore,
    harnesses: options.harnesses,
  })
  const admissions = createFilesystemRunAdmissionService({
    runs: createFilesystemRunStore({ paths }),
    workflows: workflowStore,
    harnesses: options.harnesses,
    resolveRepository: options.resolveRepository,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.createRunId === undefined ? {} : { createRunId: options.createRunId }),
  })
  const index = createFilesystemRunIndex({ paths })
  const reader = createFilesystemRunReader({ index, paths })
  const eventFeed = createFilesystemRunEventFeed({ index, paths })
  const traces = createRunFilesystemAgentTraceStore({ paths })
  const workspaces = createFilesystemGitRunWorkspaceProvisioner({
    paths,
    processRunner: options.processRunner,
    credentialHelper: options.credentialHelper,
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  const coordinatorStore = createFilesystemJournalCoordinatorStore({ paths })
  const coordinator = createJournalWorkflowCoordinator({
    runs: coordinatorStore,
    workspaces,
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  const nodeRunner = createFilesystemNodeRunner({
    harnesses: options.harnesses,
    resolveHarness: options.resolveHarness,
    reader,
    traces,
    workspaces,
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  const worker = createJournalExecutionWorker({
    runs: coordinatorStore,
    coordinator,
    runner: nodeRunner,
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  const cancellation = createJournalCancellationService({ coordinator, worker })
  return {
    paths,
    workflowStore,
    workflows,
    admissions,
    index,
    reader,
    eventFeed,
    traces,
    workspaces,
    coordinator,
    worker,
    cancellation,
    api: {
      filesystemRuns: { admissions, index, reader, cancellation, traces },
      eventFeed,
      workflows,
    },
  }
}
