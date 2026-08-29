import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'

import type { AgentExecutor } from '@slopify/shared'
import {
  createAgentNodeRunner,
  createFilesystemRunArtifactDirectory,
  createFilesystemGitRunWorkspaceProvisioner,
  createFilesystemJournalCoordinatorStore,
  createFilesystemRunAdmissionService,
  createFilesystemRunEventFeed,
  createFilesystemRunIndex,
  createFilesystemRunReader,
  createFilesystemRunStore,
  createFilesystemWorkflowStore,
  createInstanceLockManager,
  createJournalCancellationService,
  createJournalExecutionWorker,
  createJournalWorkflowCoordinator,
  createRunRecoveryService,
  createRunFilesystemAgentTraceStore,
  createWorkflowDefinitionService,
  publishManagedJsonSchemas,
  resolveSlopifyPaths,
  type AgentTraceStore,
  type AgentNodeRunRecord,
  type FilesystemRunArtifactDirectory,
  type FilesystemRunAdmissionService,
  type FilesystemRunEventFeed,
  type FilesystemRunIndex,
  type FilesystemRunReader,
  type FilesystemRunRepositoryResolution,
  type FilesystemRunWorkspaceProvisioner,
  type HarnessCatalog,
  type JournalCancellationService,
  type JournalExecutionWorker,
  type JournalRunLocator,
  type JournalWorkflowCoordinator,
  type JsonValue,
  type NodeRunner,
  type ProcessRunner,
  type RunAgentTraceStore,
  type RunRecoveryService,
  type RunWorkspaceProvisioner,
  type SlopifyPaths,
  type WorkflowDefinitionService,
  type WorkflowStore,
} from './index.js'
import { workflowFileToWorkflow } from '@slopify/shared'

import type { CreateApiAppOptions } from './app.js'
import { createFilesystemExecutionPump, type FilesystemExecutionPump } from './execution-pump.js'

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
  readonly artifacts: FilesystemRunArtifactDirectory
  readonly workspaces: FilesystemRunWorkspaceProvisioner
  readonly coordinator: JournalWorkflowCoordinator
  readonly worker: JournalExecutionWorker
  readonly cancellation: JournalCancellationService
  readonly recovery: RunRecoveryService
  readonly api: CreateApiAppOptions
}

export interface FilesystemRuntimeHealth {
  status(): Promise<Readonly<{ owned: boolean; writable: boolean }>>
}

export interface FilesystemRuntimeLifecycle {
  readonly health: FilesystemRuntimeHealth
  readonly pump: FilesystemExecutionPump
  stop(): Promise<void>
}

const capturedRunRecord = (
  detail: Extract<Awaited<ReturnType<FilesystemRunReader['get']>>, { readonly status: 'READY' }>,
): AgentNodeRunRecord => ({
  runId: detail.run.runId,
  workflowSnapshot: workflowFileToWorkflow(detail.workflowSnapshot.workflow),
  variables: detail.variablesSnapshot.values as Readonly<Record<string, JsonValue>>,
})

const createFilesystemNodeRunner = (options: {
  readonly harnesses: HarnessCatalog
  readonly resolveHarness: (harnessId: string) => AgentExecutor | undefined
  readonly reader: FilesystemRunReader
  readonly traces: RunAgentTraceStore
  readonly artifacts: FilesystemRunArtifactDirectory
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
    const record = capturedRunRecord(detail)
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
          webUrl: repository.webUrl,
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
      artifacts: { ensure: () => options.artifacts.ensure(locator) },
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
  const index = createFilesystemRunIndex({ paths })
  const workflows = createWorkflowDefinitionService({
    workflows: workflowStore,
    harnesses: options.harnesses,
    runActivity: {
      async hasActive(workflowId) {
        const active = await index.list({
          page: 1,
          pageSize: 1,
          workflowIds: [workflowId],
          statuses: ['PENDING', 'RUNNING'],
        })
        return active.pagination.totalItems > 0
      },
    },
  })
  const admissions = createFilesystemRunAdmissionService({
    runs: createFilesystemRunStore({ paths }),
    workflows: workflowStore,
    harnesses: options.harnesses,
    resolveRepository: options.resolveRepository,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.createRunId === undefined ? {} : { createRunId: options.createRunId }),
  })
  const reader = createFilesystemRunReader({ index, paths })
  const eventFeed = createFilesystemRunEventFeed({ index, paths })
  const traces = createRunFilesystemAgentTraceStore({ paths })
  const artifacts = createFilesystemRunArtifactDirectory({ paths })
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
    artifacts,
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
  const recoveryStore = {
    ...coordinatorStore,
    async list(): Promise<readonly JournalRunLocator[]> {
      const locators: JournalRunLocator[] = []
      for (let page = 1; ; page += 1) {
        const indexed = await index.list({ page, pageSize: 100 })
        locators.push(...indexed.data.map(({ locator }) => locator))
        if (page >= indexed.pagination.totalPages) return locators
      }
    },
  }
  const recovery = createRunRecoveryService({
    runs: recoveryStore,
    coordinator,
    worker,
    workspaces,
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  return {
    paths,
    workflowStore,
    workflows,
    admissions,
    index,
    reader,
    eventFeed,
    traces,
    artifacts,
    workspaces,
    coordinator,
    worker,
    cancellation,
    recovery,
    api: {
      filesystemRuns: { admissions, index, reader, cancellation, traces },
      eventFeed,
      workflows,
    },
  }
}

export const startFilesystemRuntime = async (options: {
  readonly runtime: FilesystemRuntime
  readonly pollIntervalMs: number
  readonly onError?: (error: unknown) => void
}): Promise<FilesystemRuntimeLifecycle> => {
  await mkdir(options.runtime.paths.home, { recursive: true, mode: 0o700 })
  const ownership = await createInstanceLockManager({ paths: options.runtime.paths }).acquire()
  try {
    await publishManagedJsonSchemas({ paths: options.runtime.paths })
    const health: FilesystemRuntimeHealth = {
      async status() {
        await access(options.runtime.paths.home, constants.W_OK)
        await ownership.heartbeat()
        return { owned: true, writable: true }
      },
    }
    const pump = createFilesystemExecutionPump({
      pollIntervalMs: options.pollIntervalMs,
      recovery: options.runtime.recovery,
      heartbeat: () => ownership.heartbeat(),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    })
    pump.start()
    await pump.wake()
    let stopped = false
    return {
      health,
      pump,
      async stop() {
        if (stopped) return
        stopped = true
        await pump.stop()
        await ownership.release()
      },
    }
  } catch (cause) {
    await ownership.release().catch(() => undefined)
    throw cause
  }
}
