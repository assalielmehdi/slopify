import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  createCodexCliAgentExecutor,
  createCodexHarnessInspector,
  createPiCliAgentExecutor,
  createPiHarnessInspector,
} from '@slopify/agent-runtimes'
import { WorkflowIdSchema, type AgentExecutor } from '@slopify/contracts'
import {
  createBunGitSecretStore,
  createFetchRemoteGitHost,
  createFilesystemGitConnectionRepository,
  createFilesystemRepositoryStore,
  createFilesystemSettingsStore,
  createGitConnectionService,
  createGitCredentialHelperCommand,
  createHarnessCatalog,
  createProcessRunner,
  createResourceEventFeed,
  createResourceWatcher,
  createRepositoryService,
  createRemoteRunRepositoryResolver,
  gitCredentialHelperPath,
  resolveSlopifyPaths,
  type HarnessCatalog,
  type HarnessInspector,
  type ResourceEventFeed,
  type ResourceWatcher,
  type SlopifyPaths,
  type WatchedResource,
} from '@slopify/execution-runtime'
import { WorkflowSlugSchema } from '@slopify/workflow-model'
import type { Hono } from 'hono'

import { createApiApp } from './app.js'
import { createFilesystemRuntime, startFilesystemRuntime } from './filesystem-runtime.js'
import {
  createFilesystemShutdownCoordinator,
  registerShutdownSignals,
  type ShutdownCoordinator,
} from './shutdown.js'
import { prepareFilesystemStartup } from './startup-state.js'

export type ServerConfigurationErrorCode =
  'API_HOST_INVALID' | 'API_PORT_INVALID' | 'API_SHUTDOWN_GRACE_INVALID'

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

export const createSupportedHarnessRuntime = (
  options: Readonly<{
    inspectors?: readonly HarnessInspector[]
    pi?: AgentExecutor
    codex?: AgentExecutor
  }> = {},
): Readonly<{
  harnesses: HarnessCatalog
  resolveHarness: (harnessId: string) => AgentExecutor | undefined
}> => {
  const pi = options.pi ?? createPiCliAgentExecutor()
  const codex = options.codex ?? createCodexCliAgentExecutor()
  return {
    harnesses: createHarnessCatalog({
      inspectors: options.inspectors ?? [createPiHarnessInspector(), createCodexHarnessInspector()],
    }),
    resolveHarness: (harnessId) =>
      harnessId === 'pi' ? pi : harnessId === 'codex' ? codex : undefined,
  }
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

const nonBlank = (
  value: string | undefined,
  fallback: string,
  code: 'API_HOST_INVALID',
): string => {
  if (value === undefined) return fallback
  if (value.trim() === '')
    throw new ServerConfigurationError(code, 'Configuration must not be blank')
  return value
}

const port = (value: string | undefined): number => {
  if (value === undefined) return 7_311
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
): ApiServerConfiguration => ({
  hostname: nonBlank(environment.API_HOST, '127.0.0.1', 'API_HOST_INVALID'),
  port: port(environment.API_PORT),
  shutdownGracePeriodMs: shutdownGracePeriod(environment.API_SHUTDOWN_GRACE_MS),
})

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

export const startConfiguredApiServer = async (
  environment: ApiEnvironment = process.env,
  infrastructure: Readonly<{
    serve?: ApiServerFactory
    registerSignals?: (input: { readonly coordinator: ShutdownCoordinator }) => () => void
    pollIntervalMs?: number
  }> = {},
): Promise<ApiServer> => {
  const configuration = resolveApiServerConfiguration(environment)
  const paths = resolveSlopifyPaths({ environment })
  const legacyRoot =
    environment.SLOPIFY_HOME === undefined ? join(paths.home, 'orchestrator') : paths.home
  await prepareFilesystemStartup({
    paths,
    databasePath: join(legacyRoot, 'slopify.db'),
    legacyTracesRoot: join(legacyRoot, 'traces'),
  })
  const resourceEvents = createResourceEventFeed()
  const resourceWatcher = createEditableResourceWatcher({
    paths,
    events: resourceEvents,
    onError: (error) => console.error('Editable resource reconciliation failed', error),
  })
  const startWithResourceWatcher = (app: Hono): ApiServer => {
    const server = startApiServer({
      app,
      configuration,
      ...(infrastructure.serve === undefined ? {} : { serve: infrastructure.serve }),
    })
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
  const processRunner = createProcessRunner({ maxOutputBytes: 64 * 1_024 })
  const harnessRuntime = createSupportedHarnessRuntime()
  const harnesses = harnessRuntime.harnesses
  const remoteGit = createFetchRemoteGitHost()
  const gitConnections = createGitConnectionService({
    connections: createFilesystemGitConnectionRepository({ settings }),
    secrets: createBunGitSecretStore(),
    remote: remoteGit,
  })
  const repositoryStore = createFilesystemRepositoryStore({ paths })
  const repositories = createRepositoryService({
    repositories: repositoryStore,
    connections: gitConnections,
    remote: remoteGit,
  })
  const runtime = createFilesystemRuntime({
    paths,
    harnesses,
    resolveHarness: harnessRuntime.resolveHarness,
    resolveRepository: createRemoteRunRepositoryResolver({
      repositories,
      connections: gitConnections,
      remote: remoteGit,
    }),
    processRunner,
    credentialHelper: createGitCredentialHelperCommand(process.execPath, gitCredentialHelperPath()),
  })
  const lifecycle = await startFilesystemRuntime({
    runtime,
    pollIntervalMs: infrastructure.pollIntervalMs ?? 100,
    onError: (error) => console.error('Filesystem execution recovery failed', error),
  })
  let transport: ApiServer
  try {
    transport = startWithResourceWatcher(
      createApiApp({
        ...runtime.api,
        filesystemHealth: lifecycle.health,
        gitConnections,
        harnesses,
        repositories,
        resourceEvents,
        settings,
      }),
    )
  } catch (cause) {
    await lifecycle.stop()
    throw cause
  }

  const activeRuns = async () => {
    const active: { workflowId: string; runId: string }[] = []
    for (let page = 1; ; page += 1) {
      const indexed = await runtime.index.list({
        page,
        pageSize: 100,
        statuses: ['PENDING', 'RUNNING'],
      })
      active.push(...indexed.data.map(({ locator }) => locator))
      if (page >= indexed.pagination.totalPages) return active
    }
  }
  const removeSignals = (infrastructure.registerSignals ?? registerShutdownSignals)({
    coordinator: createFilesystemShutdownCoordinator({
      server: transport,
      runs: runtime.admissions,
      activeRuns,
      cancellation: runtime.cancellation,
      execution: lifecycle.pump,
      ownership: { release: () => lifecycle.stop() },
      gracePeriodMs: configuration.shutdownGracePeriodMs,
    }),
  })
  let stopped = false
  return {
    hostname: transport.hostname,
    port: transport.port,
    async stop(closeActiveConnections) {
      if (stopped) return
      stopped = true
      runtime.admissions.stopAdmissions()
      removeSignals()
      await Promise.all([transport.stop(closeActiveConnections), lifecycle.stop()])
    },
  }
}

const executable = process.argv[1]
if (executable !== undefined && pathToFileURL(executable).href === import.meta.url) {
  await startConfiguredApiServer()
}
