import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  createBunChildAgentExecutor,
  createChatGptOAuthService,
  getBunAgentWorkerScriptPath,
} from '@slopify/agent-runtimes'
import { DEFAULT_CHATGPT_CONNECTION_ID } from '@slopify/contracts'
import {
  createProcessRunner,
  createAgentJobRunner,
  createAgentResultSchemaRegistry,
  createCoordinatorCancellationService,
  createChatGptSubscriptionConnectionDriver,
  createClickUpConnectionDriver,
  createConnectionCatalogRepository,
  createDeletionOperationRepository,
  createDeletionService,
  createConnectionRepository,
  createProjectRepository,
  createProjectService,
  createNativeGitProjectInspector,
  createConnectionService,
  createFileCredentialStore,
  createFilesystemSkillCatalog,
  createFilesystemSkillSnapshotStore,
  createFilesystemAgentTraceStore,
  createGitLabConnectionDriver,
  createOpenRouterConnectionDriver,
  createEventStore,
  createRunRepository,
  createRunService,
  createOrchestratedRunService,
  createRunEventFeed,
  createWorkflowRepository,
  createWorkflowService,
  createExecutionWorker,
  createJobRunnerRegistry,
  createSqliteCoordinatorStateStore,
  createSqliteExecutionMessageQueue,
  createWorkflowCoordinator,
  openDatabase,
  type ConnectionService,
  type Credential,
  type WorkflowRepository,
} from '@slopify/execution-runtime'
import {
  PREDEFINED_V1_WORKFLOW_ID,
  WorkflowSchema,
  createPredefinedV1Workflow,
} from '@slopify/workflow-model'
import type { Hono } from 'hono'
import { z } from 'zod'

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
  readonly skillsRoot: string
  readonly skillSnapshotsRoot: string
  readonly credentialPath: string
  readonly tracesRoot: string
  readonly shutdownGracePeriodMs: number
}

export interface ApiServer {
  readonly hostname: string
  readonly port: number
  stop(closeActiveConnections?: boolean): Promise<void>
}

type ApiServerFactory = (options: {
  readonly fetch: Hono['fetch']
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

export const ensurePredefinedWorkflow = (
  workflows: Pick<WorkflowRepository, 'get' | 'save'>,
): void => {
  const existing = workflows.get(PREDEFINED_V1_WORKFLOW_ID)
  const isLegacySeed =
    existing?.name === 'Who are you?' &&
    existing.nodes.length === 2 &&
    existing.nodes.some(({ id, type }) => id === 'identify-agent' && type === 'agent') &&
    existing.nodes.some(({ id, type }) => id === 'succeeded' && type === 'terminal') &&
    existing.edges.length === 1 &&
    existing.edges[0]?.sourceNodeId === 'identify-agent' &&
    existing.edges[0].targetNodeId === 'succeeded'

  if (existing !== undefined && !isLegacySeed) return

  workflows.save(
    createPredefinedV1Workflow({
      createdAt: '2026-08-20T23:30:00.000Z',
      agentDefaults: {
        provider: 'chatgpt-subscription',
        model: 'gpt-5.4',
        thinkingLevel: 'medium',
      },
    }),
  )
}

export const connectDefaultChatGpt = (
  connect: ConnectionService['connect'],
  input: Readonly<{ label: string; credential: Extract<Credential, { type: 'oauth' }> }>,
) =>
  connect({
    connectionId: DEFAULT_CHATGPT_CONNECTION_ID,
    type: 'chatgpt-subscription',
    label: input.label,
    configuration: { provider: 'openai-codex' },
    credential: input.credential,
  })

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
    nonBlank(environment.SLOPIFY_HOME, join(homedir(), '.slopify'), 'DATABASE_PATH_INVALID'),
  )
  const databasePath = resolve(
    nonBlank(environment.DATABASE_PATH, join(stateRoot, 'slopify.db'), 'DATABASE_PATH_INVALID'),
  )
  return {
    hostname: nonBlank(environment.API_HOST, '127.0.0.1', 'API_HOST_INVALID'),
    port: port(environment.API_PORT),
    databasePath,
    skillsRoot: resolve(environment.SKILLS_ROOT ?? join(stateRoot, 'skills')),
    skillSnapshotsRoot: resolve(
      environment.SKILL_SNAPSHOTS_ROOT ?? join(stateRoot, 'skill-snapshots'),
    ),
    credentialPath: resolve(environment.CREDENTIAL_PATH ?? join(stateRoot, 'credentials.json')),
    tracesRoot: resolve(join(stateRoot, 'traces')),
    shutdownGracePeriodMs: shutdownGracePeriod(environment.API_SHUTDOWN_GRACE_MS),
  }
}

export const startApiServer = (input: {
  readonly app: Hono
  readonly configuration: ApiServerConfiguration
  readonly serve?: ApiServerFactory
}): ApiServer =>
  (input.serve ?? createBunApiServer)({
    fetch: input.app.fetch,
    hostname: input.configuration.hostname,
    port: input.configuration.port,
  })

export const startConfiguredApiServer = (environment: ApiEnvironment = process.env): ApiServer => {
  const configuration = resolveApiServerConfiguration(environment)
  let database
  try {
    database = openDatabase({ path: configuration.databasePath })
  } catch {
    database = undefined
  }
  if (database === undefined) {
    return startApiServer({ app: createApiApp({}), configuration })
  }

  const projectRepository = createProjectRepository(database)
  const workflowRepository = createWorkflowRepository(database)
  ensurePredefinedWorkflow(workflowRepository)
  const runRepository = createRunRepository(database)
  const eventStore = createEventStore(database)
  const credentials = createFileCredentialStore({ path: configuration.credentialPath })
  const connectionCatalog = createConnectionCatalogRepository(database)
  const connections = createConnectionService({
    connections: createConnectionRepository(database),
    credentials,
    drivers: [
      createGitLabConnectionDriver(),
      createClickUpConnectionDriver(),
      createOpenRouterConnectionDriver(),
      createChatGptSubscriptionConnectionDriver(),
    ],
  })
  const skills = createFilesystemSkillCatalog({ root: configuration.skillsRoot })
  const skillSnapshots = createFilesystemSkillSnapshotStore({
    root: configuration.skillSnapshotsRoot,
  })
  const traces = createFilesystemAgentTraceStore({ root: configuration.tracesRoot })
  const projects = createProjectService({
    projects: projectRepository,
    inspector: createNativeGitProjectInspector({
      processRunner: createProcessRunner({ maxOutputBytes: 8_192, redactedValues: [] }),
    }),
  })
  const deletions = createDeletionService({
    operations: createDeletionOperationRepository(database),
    handlers: [projects],
  })
  const queue = createSqliteExecutionMessageQueue(database)
  const coordinator = createWorkflowCoordinator({
    coordinatorId: `coordinator-${process.pid}`,
    queue,
    state: createSqliteCoordinatorStateStore(database),
  })
  const agent = createBunChildAgentExecutor({
    childScriptPath: getBunAgentWorkerScriptPath(),
    credentials,
    async resolveContext(input) {
      const run = runRepository.get(input.runId)
      if (run === undefined) throw new Error('Run was not found')
      const workflow = WorkflowSchema.parse(run.workflowSnapshot)
      const parsedNode = workflow.nodes.find(({ id }) => id === input.nodeId)
      if (parsedNode?.type !== 'agent') throw new Error('Agent job was not found')
      const inference = connections.get(parsedNode.job.inference.connectionId)
      if (inference.status !== 'CONNECTED' || inference.category !== 'inference')
        throw new Error('Inference connection is unavailable')
      const snapshots = await Promise.all(
        parsedNode.job.skillSnapshotRefs.map(async (reference) => {
          const snapshot = await skillSnapshots.get(reference.digest)
          if (snapshot === undefined) throw new Error('Skill snapshot is unavailable')
          return {
            skillId: reference.skillId,
            name: reference.name,
            description: reference.description,
            hostPath: snapshot.path,
          }
        }),
      )
      const connectorRecords = parsedNode.job.connectorIds.map((connectionId) =>
        connections.get(connectionId),
      )
      const connectorsForVm = connectorRecords.map((connection) => {
        if (
          connection.status !== 'CONNECTED' ||
          connection.category !== 'connector' ||
          (connection.type !== 'gitlab' && connection.type !== 'clickup')
        ) {
          throw new Error('Connector connection is unavailable')
        }
        const configuration = z
          .strictObject({ baseUrl: z.url().optional() })
          .default({})
          .parse(connection.configuration)
        const defaultHost = connection.type === 'gitlab' ? 'gitlab.com' : 'api.clickup.com'
        return {
          connectionId: connection.connectionId,
          type: connection.type,
          authority: connection.authority,
          allowedHosts: [
            configuration.baseUrl === undefined
              ? defaultHost
              : new URL(configuration.baseUrl).hostname,
          ],
        }
      })
      return {
        outputSchemaRef: parsedNode.result.schemaRef,
        inferenceConnectionId: inference.connectionId,
        resourceBundle: {
          bundleId: input.resourceBundleId,
          applicationVersion: '1',
          skills: [],
          promptFragments: [],
          contextFiles: [],
        },
        skills: snapshots,
        connectors: connectorsForVm,
      }
    },
  })
  const agentRunner = createAgentJobRunner({
    agent,
    runs: runRepository,
    traces,
    resultSchemas: createAgentResultSchemaRegistry({
      'json:any-v1': z.json(),
    }),
    resolveInference(connectionId) {
      try {
        const connection = connections.get(connectionId)
        if (connection.status !== 'CONNECTED' || connection.category !== 'inference')
          return undefined
        return {
          provider: connection.type === 'chatgpt-subscription' ? 'openai-codex' : 'openrouter',
        }
      } catch {
        return undefined
      }
    },
  })
  const worker = createExecutionWorker({
    workerId: `worker-${process.pid}`,
    queue,
    runners: createJobRunnerRegistry({
      agent: agentRunner,
    }),
    concurrency: 2,
  })
  const pump = createExecutionPump({
    coordinator,
    worker,
    pollIntervalMs: 100,
  })
  const baseRunService = createRunService({
    events: eventStore,
    runs: runRepository,
    workflows: workflowRepository,
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
  const server = startApiServer({
    app: createApiApp({
      cancellation,
      chatGptOAuth: createChatGptOAuthService({
        async connect({ label, credential }) {
          const connection = await connectDefaultChatGpt(connections.connect, {
            label,
            credential,
          })
          return connection.connectionId
        },
      }),
      connections,
      connectionCatalog,
      database,
      deletions,
      eventFeed: createRunEventFeed({ events: eventStore, runs: runRepository }),
      projects,
      runs: runService,
      traces,
      skills,
      workflows: createWorkflowService({
        workflows: workflowRepository,
      }),
    }),
    configuration,
  })
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
