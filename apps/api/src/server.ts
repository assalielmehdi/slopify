import { mkdirSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createPiCliAgentExecutor, createPiHarnessInspector } from '@slopify/agent-runtimes'
import { WorkflowIdSchema } from '@slopify/contracts'
import {
  DatabaseInitializationError,
  createAgentNodeRunner,
  createBunGitSecretStore,
  createCoordinatorCancellationService,
  createDeletionOperationRepository,
  createDeletionService,
  createEventStore,
  createExecutionWorker,
  createFetchRemoteGitHost,
  createFilesystemAgentTraceStore,
  createFilesystemGitConnectionRepository,
  createFilesystemRepositoryStore,
  createFilesystemSettingsStore,
  createFilesystemWorkflowStore,
  createGitConnectionService,
  createGitCredentialHelperCommand,
  createHarnessCatalog,
  createNativeGitRunWorkspaceProvisioner,
  createOrchestratedRunService,
  createProcessRunner,
  createResourceEventFeed,
  createResourceWatcher,
  createRepositoryService,
  createRemoteRunRepositoryResolver,
  createRunEventFeed,
  createRunRepository,
  createRunService,
  createSqliteCoordinatorStateStore,
  createSqliteExecutionMessageQueue,
  createWorkflowCoordinator,
  createWorkflowDefinitionService,
  createWorkflowRepository,
  createWorkflowService,
  gitCredentialHelperPath,
  openDatabase,
  resolveSlopifyPaths,
  type ResourceEventFeed,
  type ResourceWatcher,
  type SlopifyPaths,
  type WatchedResource,
  type WorkflowRepository,
} from '@slopify/execution-runtime'
import { createDefaultWorkflow, WorkflowSlugSchema } from '@slopify/workflow-model'
import type { Hono } from 'hono'

import { createApiApp } from './app.js'
import { createExecutionPump } from './execution-pump.js'
import { createShutdownCoordinator, registerShutdownSignals } from './shutdown.js'

export type ServerConfigurationErrorCode =
  'API_HOST_INVALID' | 'API_PORT_INVALID' | 'API_SHUTDOWN_GRACE_INVALID' | 'DATABASE_PATH_INVALID'

export class ServerConfigurationError extends Error {
  readonly code: ServerConfigurationErrorCode

  constructor(code: ServerConfigurationErrorCode, message: string) {
    super(message)
    this.name = 'ServerConfigurationError'
    this.code = code
  }
}

export interface ApiServerConfiguration {
  readonly hostname: string
  readonly port: number
  readonly databasePath: string
  readonly tracesRoot: string
  readonly workspacesRoot: string
  readonly shutdownGracePeriodMs: number
}

export interface ApiServer {
  readonly hostname: string
  readonly port: number
  stop(closeActiveConnections?: boolean): Promise<void>
}

type ApiRequestServer = Pick<Bun.Server<unknown>, 'timeout'>

type ApiServerFactory = (options: {
  readonly fetch: (request: Request, server: ApiRequestServer) => ReturnType<Hono['fetch']>
  readonly hostname: string
  readonly port: number
}) => ApiServer

const createBunApiServer: ApiServerFactory = (options) => {
  const server = Bun.serve(options)
  return {
    hostname: server.hostname ?? options.hostname,
    port: server.port ?? options.port,
    stop: (closeActiveConnections) => server.stop(closeActiveConnections),
  }
}

type ApiEnvironment = Readonly<Record<string, string | undefined>>

export interface EditableResourceWatcher {
  start(): Promise<void>
  reconcile(): Promise<void>
  stop(): Promise<void>
}

const workflowResources = async (paths: SlopifyPaths): Promise<readonly WatchedResource[]> => {
  let entries
  try {
    entries = await readdir(paths.workflowsDirectory, { withFileTypes: true })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw cause
  }
  return entries.flatMap((entry) => {
    if (!entry.isDirectory() || !WorkflowSlugSchema.safeParse(entry.name).success) return []
    return [
      {
        resourceId: `workflow:${entry.name}`,
        path: paths.workflow(entry.name).definitionFile,
      },
    ]
  })
}

export const createEditableResourceWatcher = (options: {
  readonly paths: SlopifyPaths
  readonly events: ResourceEventFeed
  readonly onError?: (error: unknown) => void
}): EditableResourceWatcher => {
  const watcher: ResourceWatcher = createResourceWatcher({
    directories: [options.paths.home],
    resources: async () => [
      { resourceId: 'settings', path: options.paths.settingsFile },
      { resourceId: 'repositories', path: options.paths.repositoriesFile },
      ...(await workflowResources(options.paths)),
    ],
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  })

  return {
    start: () =>
      watcher.start((event) => {
        const resource =
          event.resourceId === 'settings'
            ? ({ type: 'SETTINGS' } as const)
            : event.resourceId === 'repositories'
              ? ({ type: 'REPOSITORIES' } as const)
              : ({
                  type: 'WORKFLOW',
                  workflowId: WorkflowIdSchema.parse(event.resourceId.slice('workflow:'.length)),
                } as const)
        options.events.publish({
          change: event.type,
          resource,
          revision: event.revision,
        })
      }),
    reconcile: () => watcher.reconcile(),
    stop: () => watcher.stop(),
  }
}

export const ensureInitialWorkflow = (
  workflows: Pick<WorkflowRepository, 'insert' | 'list'>,
): void => {
  if (workflows.list().length > 0) return
  workflows.insert(createDefaultWorkflow({ createdAt: new Date().toISOString() }))
}

const nonBlank = (
  value: string | undefined,
  fallback: string,
  code: 'API_HOST_INVALID' | 'DATABASE_PATH_INVALID',
): string => {
  if (value === undefined) return fallback
  if (value.trim() === '')
    throw new ServerConfigurationError(code, 'Configuration must not be blank')
  return value
}

const port = (value: string | undefined): number => {
  if (value === undefined) return 3_001
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new ServerConfigurationError(
      'API_PORT_INVALID',
      'API_PORT must be an integer from 1 to 65535',
    )
  }
  return parsed
}

const shutdownGracePeriod = (value: string | undefined): number => {
  if (value === undefined) return 10_000
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 300_000) {
    throw new ServerConfigurationError(
      'API_SHUTDOWN_GRACE_INVALID',
      'API_SHUTDOWN_GRACE_MS must be an integer from 1 to 300000',
    )
  }
  return parsed
}

export const resolveApiServerConfiguration = (
  environment: ApiEnvironment = process.env,
): ApiServerConfiguration => {
  const stateRoot = resolve(
    nonBlank(
      environment.SLOPIFY_HOME,
      join(homedir(), '.slopify', 'orchestrator'),
      'DATABASE_PATH_INVALID',
    ),
  )
  return {
    hostname: nonBlank(environment.API_HOST, '127.0.0.1', 'API_HOST_INVALID'),
    port: port(environment.API_PORT),
    databasePath: resolve(
      nonBlank(environment.DATABASE_PATH, join(stateRoot, 'slopify.db'), 'DATABASE_PATH_INVALID'),
    ),
    tracesRoot: resolve(
      nonBlank(environment.TRACES_ROOT, join(stateRoot, 'traces'), 'DATABASE_PATH_INVALID'),
    ),
    workspacesRoot: resolve(
      nonBlank(environment.WORKSPACES_ROOT, join(stateRoot, 'workspaces'), 'DATABASE_PATH_INVALID'),
    ),
    shutdownGracePeriodMs: shutdownGracePeriod(environment.API_SHUTDOWN_GRACE_MS),
  }
}

export const startApiServer = (input: {
  readonly app: Hono
  readonly configuration: ApiServerConfiguration
  readonly serve?: ApiServerFactory
}): ApiServer =>
  (input.serve ?? createBunApiServer)({
    fetch(request, server) {
      if (
        request.method === 'GET' &&
        (/^\/api\/runs\/[^/]+\/events$/u.test(new URL(request.url).pathname) ||
          new URL(request.url).pathname === '/api/resource-events')
      ) {
        server.timeout(request, 0)
      }
      return input.app.fetch(request)
    },
    hostname: input.configuration.hostname,
    port: input.configuration.port,
  })

export const startConfiguredApiServer = (environment: ApiEnvironment = process.env): ApiServer => {
  const configuration = resolveApiServerConfiguration(environment)
  const paths = resolveSlopifyPaths({ environment })
  mkdirSync(paths.home, { recursive: true, mode: 0o700 })
  mkdirSync(paths.workflowsDirectory, { recursive: true, mode: 0o700 })
  const resourceEvents = createResourceEventFeed()
  const resourceWatcher = createEditableResourceWatcher({
    paths,
    events: resourceEvents,
    onError: (error) => console.error('Editable resource reconciliation failed', error),
  })
  const startWithResourceWatcher = (app: Hono): ApiServer => {
    const server = startApiServer({ app, configuration })
    const ready = resourceWatcher
      .start()
      .catch((error) => console.error('Editable resource watcher failed to start', error))
    return {
      hostname: server.hostname,
      port: server.port,
      async stop(closeActiveConnections) {
        await ready
        await resourceWatcher.stop()
        await server.stop(closeActiveConnections)
      },
    }
  }
  const settings = createFilesystemSettingsStore({ paths })
  let database
  try {
    database = openDatabase({ path: configuration.databasePath })
  } catch (cause) {
    if (
      cause instanceof DatabaseInitializationError &&
      cause.code === 'DATABASE_SCHEMA_INCOMPATIBLE'
    ) {
      throw cause
    }
    database = undefined
  }
  if (database === undefined) {
    return startWithResourceWatcher(createApiApp({ resourceEvents, settings }))
  }

  const processRunner = createProcessRunner({ maxOutputBytes: 64 * 1_024 })
  const harnesses = createHarnessCatalog({ inspectors: [createPiHarnessInspector()] })
  const workflows = createWorkflowDefinitionService({
    workflows: createFilesystemWorkflowStore({ paths }),
    harnesses,
  })
  const pi = createPiCliAgentExecutor()
  const remoteGit = createFetchRemoteGitHost()
  const gitConnections = createGitConnectionService({
    connections: createFilesystemGitConnectionRepository({ settings }),
    secrets: createBunGitSecretStore(),
    remote: remoteGit,
  })
  const repositoryStore = createFilesystemRepositoryStore({ paths })
  const workflowRepository = createWorkflowRepository(database)
  ensureInitialWorkflow(workflowRepository)
  const runRepository = createRunRepository(database)
  const eventStore = createEventStore(database)
  const traces = createFilesystemAgentTraceStore({ root: configuration.tracesRoot })
  const repositories = createRepositoryService({
    repositories: repositoryStore,
    connections: gitConnections,
    remote: remoteGit,
  })
  const legacyWorkflows = createWorkflowService({ workflows: workflowRepository, harnesses })
  const deletions = createDeletionService({
    operations: createDeletionOperationRepository(database),
    handlers: [repositories, legacyWorkflows],
  })
  const queue = createSqliteExecutionMessageQueue(database)
  const coordinator = createWorkflowCoordinator({
    coordinatorId: `coordinator-${process.pid}`,
    queue,
    state: createSqliteCoordinatorStateStore(database),
  })
  const workspaces = createNativeGitRunWorkspaceProvisioner({
    runs: runRepository,
    processRunner,
    workspacesRoot: configuration.workspacesRoot,
    credentialHelper: createGitCredentialHelperCommand(process.execPath, gitCredentialHelperPath()),
  })
  const agentRunner = createAgentNodeRunner({
    harnesses,
    resolveHarness: (harnessId) => (harnessId === 'pi' ? pi : undefined),
    workspaces,
    runs: runRepository,
    traces,
  })
  const worker = createExecutionWorker({
    workerId: `worker-${process.pid}`,
    queue,
    runner: agentRunner,
    concurrency: 2,
  })
  const pump = createExecutionPump({
    coordinator,
    worker,
    pollIntervalMs: 100,
    recoverExpired() {
      const timestamp = new Date().toISOString()
      queue.recoverExpired({ destination: 'WORKER', now: timestamp, retry: true })
      queue.recoverExpired({ destination: 'COORDINATOR', now: timestamp, retry: true })
    },
    async cleanupTerminalRuns() {
      for (const runId of runRepository.listTerminalRunIdsNeedingWorkspaceCleanup()) {
        await workspaces.cleanup(runId).catch(() => undefined)
      }
    },
  })
  const baseRunService = createRunService({
    events: eventStore,
    runs: runRepository,
    workflows: workflowRepository,
    harnesses,
    resolveRepository: createRemoteRunRepositoryResolver({
      repositories,
      connections: gitConnections,
      remote: remoteGit,
    }),
  })
  const orchestratedRuns = createOrchestratedRunService({
    runs: baseRunService,
    coordinator,
  })
  const runService = {
    ...orchestratedRuns,
    async create(input: Parameters<typeof orchestratedRuns.create>[0]) {
      const run = await orchestratedRuns.create(input)
      void pump.wake()
      return run
    },
  }
  const cancellation = createCoordinatorCancellationService({
    runs: runRepository,
    coordinator,
    worker,
  })
  const server = startWithResourceWatcher(
    createApiApp({
      cancellation,
      database,
      deletions,
      eventFeed: createRunEventFeed({ events: eventStore, runs: runRepository }),
      gitConnections,
      harnesses,
      repositories,
      resourceEvents,
      runs: runService,
      settings,
      traces,
      workflows,
    }),
  )
  pump.start()
  registerShutdownSignals({
    coordinator: createShutdownCoordinator({
      server,
      runs: runService,
      cancellation,
      execution: pump,
      database,
      gracePeriodMs: configuration.shutdownGracePeriodMs,
    }),
  })
  return server
}

const executable = process.argv[1]
if (executable !== undefined && pathToFileURL(executable).href === import.meta.url) {
  startConfiguredApiServer()
}
