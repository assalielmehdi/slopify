import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import type { Server } from 'node:http'
import { join, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import {
  createBunChildAgentExecutor,
  createChatGptOAuthService,
  getBunAgentWorkerScriptPath,
} from '@loop/agent-runtimes'
import { createClickUpClient } from '@loop/clickup-artifacts'
import {
  ConnectorStatusSchema,
  DEFAULT_CHATGPT_CONNECTION_ID,
  DEFAULT_PROFILE_ID,
  DEFAULT_TASK_REFERENCE,
  type ConnectorStatus,
} from '@loop/contracts'
import {
  createProcessRunner,
  createAgentJobRunner,
  createAgentResultSchemaRegistry,
  createCoordinatorCancellationService,
  createChatGptSubscriptionConnectionDriver,
  createClickUpConnectionDriver,
  createConnectionRepository,
  createConnectionService,
  createFileCredentialStore,
  createFilesystemSkillCatalog,
  createFilesystemSkillSnapshotStore,
  createGitLabConnectionDriver,
  createOpenRouterConnectionDriver,
  createProfileRepository,
  createProjectProfileService,
  createReadinessService,
  createEventStore,
  createRunRepository,
  createRunService,
  createOrchestratedRunService,
  createRunEventFeed,
  createWorkflowRepository,
  createWorkflowService,
  createExecutionWorker,
  createJobRunnerRegistry,
  createLoadClickUpTaskExecutor,
  createExecutorRegistry,
  createNodeExecutorJobRunner,
  createSqliteCoordinatorStateStore,
  createSqliteExecutionMessageQueue,
  createWorkflowCoordinator,
  ExecutionPlanOutputSchema,
  FindingResolutionOutputSchema,
  ImplementationOutputSchema,
  openDatabase,
  RepositorySelectionSchema,
  ReviewFindingsOutputSchema,
  type RunTaskResolver,
  type ConnectionService,
  type Credential,
  type CredentialStore,
  type ProjectProfileService,
  type WorkflowRepository,
} from '@loop/execution-runtime'
import {
  PREDEFINED_V1_WORKFLOW_ID,
  WorkflowRevisionSchema,
  createPredefinedV1Revision,
} from '@loop/workflow-model'
import type { Hono } from 'hono'
import { z } from 'zod'

import { createApiApp } from './app.js'
import { createExecutionPump } from './execution-pump.js'
import { createShutdownCoordinator, registerShutdownSignals } from './shutdown.js'

export type ServerConfigurationErrorCode =
  | 'API_HOST_INVALID'
  | 'API_PORT_INVALID'
  | 'API_SHUTDOWN_GRACE_INVALID'
  | 'DATABASE_PATH_INVALID'
  | 'WORKSPACE_ROOT_INVALID'

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
  readonly workspaceRoot: string
  readonly skillsRoot: string
  readonly skillSnapshotsRoot: string
  readonly credentialPath: string
  readonly shutdownGracePeriodMs: number
}

type ApiEnvironment = Readonly<Record<string, string | undefined>>

const PREDEFINED_V1_REVISION_ID = 'revision-basic-agent-02'

export const ensurePredefinedWorkflow = (
  workflows: Pick<WorkflowRepository, 'addRevision' | 'getRevision'>,
): void => {
  const reference = {
    workflowId: PREDEFINED_V1_WORKFLOW_ID,
    revisionId: PREDEFINED_V1_REVISION_ID,
  }
  if (workflows.getRevision(reference) !== undefined) return

  workflows.addRevision(
    createPredefinedV1Revision({
      revisionId: PREDEFINED_V1_REVISION_ID,
      createdAt: '2026-08-20T23:30:00.000Z',
      agentDefaults: {
        provider: 'chatgpt-subscription',
        model: 'gpt-5.4',
        thinkingLevel: 'medium',
      },
    }),
  )
}

export const ensureDefaultProfile = (
  profiles: Pick<ProjectProfileService, 'get' | 'save'>,
): void => {
  if (profiles.get(DEFAULT_PROFILE_ID) !== undefined) return
  profiles.save({
    profileId: DEFAULT_PROFILE_ID,
    displayName: 'Default profile',
    clickupWorkspaceId: 'not-required',
    clickupListId: 'not-required',
    clickupInReviewStatusId: 'not-required',
    repositories: [],
  })
}

export const createDefaultAwareTaskResolver = (tasks: RunTaskResolver): RunTaskResolver => ({
  resolve(taskReference, context) {
    if (taskReference !== DEFAULT_TASK_REFERENCE) return tasks.resolve(taskReference, context)
    return Promise.resolve({
      taskId: DEFAULT_TASK_REFERENCE,
      customTaskId: null,
      url: 'http://localhost:3000/runs/new',
      title: 'Basic agent run',
      description: 'Ask the agent who it is and what its name is.',
      status: { id: null, name: 'ready', type: 'local' },
      priority: null,
      comments: [],
      resourceLinks: [],
    })
  },
})

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
  code: 'API_HOST_INVALID' | 'DATABASE_PATH_INVALID' | 'WORKSPACE_ROOT_INVALID',
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
    nonBlank(environment.SLOPIFY_HOME, join(homedir(), '.slopify'), 'WORKSPACE_ROOT_INVALID'),
  )
  const databasePath = resolve(
    nonBlank(environment.DATABASE_PATH, join(stateRoot, 'slopify.db'), 'DATABASE_PATH_INVALID'),
  )
  const workspaceRoot = resolve(
    nonBlank(environment.WORKSPACE_ROOT, join(stateRoot, 'workspaces'), 'WORKSPACE_ROOT_INVALID'),
  )

  return {
    hostname: nonBlank(environment.API_HOST, '127.0.0.1', 'API_HOST_INVALID'),
    port: port(environment.API_PORT),
    databasePath,
    workspaceRoot,
    skillsRoot: resolve(environment.SKILLS_ROOT ?? join(stateRoot, 'skills')),
    skillSnapshotsRoot: resolve(
      environment.SKILL_SNAPSHOTS_ROOT ?? join(stateRoot, 'skill-snapshots'),
    ),
    credentialPath: resolve(environment.CREDENTIAL_PATH ?? join(stateRoot, 'credentials.json')),
    shutdownGracePeriodMs: shutdownGracePeriod(environment.API_SHUTDOWN_GRACE_MS),
  }
}

const configured = (value: string | undefined): boolean =>
  value !== undefined && value.trim() !== ''

export const resolveConnectorStatus = (
  connections: Pick<ConnectionService, 'list'>,
): ConnectorStatus => {
  const connected = connections.list().filter(({ status }) => status === 'CONNECTED')
  return ConnectorStatusSchema.parse({
    clickup: connected.some(({ type }) => type === 'clickup'),
    gitlab: connected.some(({ type }) => type === 'gitlab'),
    modelProvider: connected.some(
      ({ type }) => type === 'openrouter' || type === 'chatgpt-subscription',
    ),
  })
}

export const resolveEnvironmentConnectorStatus = (environment: ApiEnvironment): ConnectorStatus =>
  ConnectorStatusSchema.parse({
    clickup: configured(environment.CLICKUP_API_TOKEN),
    gitlab: configured(environment.GITLAB_TOKEN),
    modelProvider: configured(environment.MODEL_PROVIDER_API_KEY),
  })

type ClickUpTaskClientFactory = (options: {
  readonly baseUrl?: string
  readonly token: string
  readonly workspaceId: string
}) => Readonly<{ getTask(taskReference: string): Promise<unknown> }>

export const createConfiguredTaskResolver = (
  environment: ApiEnvironment,
  createClient: ClickUpTaskClientFactory = createClickUpClient,
): RunTaskResolver => ({
  async resolve(taskReference, context) {
    if (context === undefined) throw new Error('ClickUp workspace context is required')
    const baseUrl = environment.CLICKUP_API_BASE_URL
    const clientOptions = {
      token: environment.CLICKUP_API_TOKEN ?? '',
      workspaceId: context.clickupWorkspaceId,
    }
    const client =
      baseUrl === undefined || baseUrl.trim() === ''
        ? createClient(clientOptions)
        : createClient({ ...clientOptions, baseUrl })
    return z.json().parse(await client.getTask(taskReference))
  },
})

export const createConnectedTaskResolver = (
  connections: Pick<ConnectionService, 'list'>,
  credentials: CredentialStore,
  createClient: ClickUpTaskClientFactory = createClickUpClient,
): RunTaskResolver => ({
  async resolve(taskReference, context) {
    if (context === undefined) throw new Error('ClickUp workspace context is required')
    const connection = connections
      .list()
      .find(({ type, status }) => type === 'clickup' && status === 'CONNECTED')
    if (connection === undefined) throw new Error('ClickUp connection is unavailable')
    const credential = await credentials.read(connection.connectionId)
    if (credential?.type !== 'api_key') throw new Error('ClickUp credential is unavailable')
    const configuration = z
      .strictObject({ baseUrl: z.url().optional() })
      .default({})
      .parse(connection.configuration)
    const options = { token: credential.key, workspaceId: context.clickupWorkspaceId }
    const client =
      configuration.baseUrl === undefined
        ? createClient(options)
        : createClient({ ...options, baseUrl: configuration.baseUrl })
    return z.json().parse(await client.getTask(taskReference))
  },
})

export const startApiServer = (input: {
  readonly app: Hono
  readonly configuration: ApiServerConfiguration
}): Server =>
  serve({
    fetch: input.app.fetch,
    hostname: input.configuration.hostname,
    port: input.configuration.port,
  }) as Server

export const startConfiguredApiServer = (environment: ApiEnvironment = process.env): Server => {
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

  const profileRepository = createProfileRepository(database)
  const workflowRepository = createWorkflowRepository(database)
  ensurePredefinedWorkflow(workflowRepository)
  const runRepository = createRunRepository(database)
  const eventStore = createEventStore(database)
  const credentials = createFileCredentialStore({ path: configuration.credentialPath })
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
  const profileService = createProjectProfileService({
    profiles: profileRepository,
    runtimeMode: 'native',
    workspaceRoot: configuration.workspaceRoot,
  })
  ensureDefaultProfile(profileService)
  const readiness = createReadinessService({
    profiles: profileService,
    processRunner: createProcessRunner({ maxOutputBytes: 65_536, redactedValues: [] }),
    connectors: () => resolveConnectorStatus(connections),
  })
  const tasks = createDefaultAwareTaskResolver(
    createConnectedTaskResolver(connections, credentials),
  )
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
      const workflow = WorkflowRevisionSchema.parse(run.effectiveConfiguration)
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
    resultSchemas: createAgentResultSchemaRegistry({
      'json:any-v1': z.json(),
      'workflow-output/repository-selection-v1': RepositorySelectionSchema,
      'workflow-output/execution-plan-v1': ExecutionPlanOutputSchema,
      'workflow-output/implementation-summary-v1': ImplementationOutputSchema,
      'workflow-output/review-findings-v1': ReviewFindingsOutputSchema,
      'workflow-output/finding-resolution-v1': FindingResolutionOutputSchema,
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
  const deterministicRunner = createNodeExecutorJobRunner({
    runs: runRepository,
    executors: createExecutorRegistry({
      commands: { 'load-clickup-task': createLoadClickUpTaskExecutor() },
    }),
  })
  const worker = createExecutionWorker({
    workerId: `worker-${process.pid}`,
    queue,
    runners: createJobRunnerRegistry({
      agent: agentRunner,
      command: deterministicRunner,
      router: deterministicRunner,
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
    profiles: profileRepository,
    readiness,
    runs: runRepository,
    tasks,
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
      database,
      eventFeed: createRunEventFeed({ events: eventStore, runs: runRepository }),
      profiles: profileService,
      readiness,
      runs: runService,
      skills,
      tasks,
      workflows: createWorkflowService({
        workflows: workflowRepository,
        skills,
        skillSnapshots,
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
