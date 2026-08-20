import { pathToFileURL } from 'node:url'
import type { Server } from 'node:http'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { serve } from '@hono/node-server'
import { createClickUpClient } from '@loop/clickup-artifacts'
import { ConnectorStatusSchema, type ConnectorStatus } from '@loop/contracts'
import {
  createProcessRunner,
  createCancellationService,
  createProfileRepository,
  createProjectProfileService,
  createReadinessService,
  createRecoveryService,
  createEventStore,
  createRunRepository,
  createRunService,
  createRunEventFeed,
  createWorkflowRepository,
  createWorkflowService,
  openDatabase,
  type RunTaskResolver,
} from '@loop/execution-runtime'
import type { Hono } from 'hono'
import { z } from 'zod'

import { createApiApp } from './app.js'
import { createShutdownCoordinator, registerShutdownSignals } from './shutdown.js'

export type ServerConfigurationErrorCode =
  | 'API_CONTAINER_MODE_INVALID'
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
  readonly shutdownGracePeriodMs: number
}

type ApiEnvironment = Readonly<Record<string, string | undefined>>

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

const containerPath = (input: {
  readonly value: string | undefined
  readonly fallback: string
  readonly root: string
  readonly code: 'DATABASE_PATH_INVALID' | 'WORKSPACE_ROOT_INVALID'
  readonly allowRoot: boolean
}): string => {
  const candidate = nonBlank(input.value, input.fallback, input.code)
  const normalized = resolve(candidate)
  const relativePath = relative(input.root, normalized)
  const isWithinRoot =
    isAbsolute(candidate) &&
    !isAbsolute(relativePath) &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    (input.allowRoot || relativePath !== '')

  if (!isWithinRoot) {
    throw new ServerConfigurationError(
      input.code,
      `Configuration must resolve within ${input.root}`,
    )
  }
  return normalized
}

const containerMode = (value: string | undefined): boolean => {
  if (value === undefined || value === 'false') return false
  if (value === 'true') return true
  throw new ServerConfigurationError(
    'API_CONTAINER_MODE_INVALID',
    'API_CONTAINER_MODE must be true or false',
  )
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
  const isContainer = containerMode(environment.API_CONTAINER_MODE)
  const databasePath = isContainer
    ? containerPath({
        value: environment.DATABASE_PATH,
        fallback: '/var/lib/workbench/workbench.sqlite',
        root: '/var/lib/workbench',
        code: 'DATABASE_PATH_INVALID',
        allowRoot: false,
      })
    : nonBlank(environment.DATABASE_PATH, './data/workbench.sqlite', 'DATABASE_PATH_INVALID')
  const workspaceRoot = isContainer
    ? containerPath({
        value: environment.WORKSPACE_ROOT,
        fallback: '/workspace',
        root: '/workspace',
        code: 'WORKSPACE_ROOT_INVALID',
        allowRoot: true,
      })
    : nonBlank(environment.WORKSPACE_ROOT, '/workspace', 'WORKSPACE_ROOT_INVALID')

  return {
    hostname: nonBlank(
      environment.API_HOST,
      isContainer ? '0.0.0.0' : '127.0.0.1',
      'API_HOST_INVALID',
    ),
    port: port(environment.API_PORT),
    databasePath,
    workspaceRoot,
    shutdownGracePeriodMs: shutdownGracePeriod(environment.API_SHUTDOWN_GRACE_MS),
  }
}

const configured = (value: string | undefined): boolean =>
  value !== undefined && value.trim() !== ''

export const resolveConnectorStatus = (environment: ApiEnvironment): ConnectorStatus =>
  ConnectorStatusSchema.parse({
    clickup: configured(environment.CLICKUP_API_TOKEN),
    gitlab: configured(environment.GITLAB_TOKEN),
    modelProvider: configured(environment.MODEL_PROVIDER_API_KEY),
  })

type ClickUpTaskClientFactory = (options: {
  readonly token: string
  readonly workspaceId: string
}) => Readonly<{ getTask(taskReference: string): Promise<unknown> }>

export const createConfiguredTaskResolver = (
  environment: ApiEnvironment,
  createClient: ClickUpTaskClientFactory = createClickUpClient,
): RunTaskResolver => ({
  async resolve(taskReference, context) {
    if (context === undefined) throw new Error('ClickUp workspace context is required')
    return z.json().parse(
      await createClient({
        token: environment.CLICKUP_API_TOKEN ?? '',
        workspaceId: context.clickupWorkspaceId,
      }).getTask(taskReference),
    )
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
  const runRepository = createRunRepository(database)
  const eventStore = createEventStore(database)
  createRecoveryService({ runs: runRepository }).reconcile()
  const profileService = createProjectProfileService({
    profiles: profileRepository,
    runtimeMode: containerMode(environment.API_CONTAINER_MODE) ? 'container' : 'native',
    workspaceRoot: configuration.workspaceRoot,
  })
  const redactedValues = [
    environment.CLICKUP_API_TOKEN,
    environment.GITLAB_TOKEN,
    environment.MODEL_PROVIDER_API_KEY,
  ].filter((value): value is string => configured(value))
  const readiness = createReadinessService({
    profiles: profileService,
    processRunner: createProcessRunner({ maxOutputBytes: 65_536, redactedValues }),
    connectors: () => resolveConnectorStatus(environment),
  })
  const tasks = createConfiguredTaskResolver(environment)
  const runService = createRunService({
    events: eventStore,
    profiles: profileRepository,
    readiness,
    runs: runRepository,
    tasks,
    workflows: workflowRepository,
  })
  const cancellation = createCancellationService({
    runs: runRepository,
    activeExecution: () => undefined,
  })
  const server = startApiServer({
    app: createApiApp({
      cancellation,
      database,
      eventFeed: createRunEventFeed({ events: eventStore, runs: runRepository }),
      profiles: profileService,
      readiness,
      runs: runService,
      tasks,
      workflows: createWorkflowService({ workflows: workflowRepository }),
    }),
    configuration,
  })
  registerShutdownSignals({
    coordinator: createShutdownCoordinator({
      server,
      runs: runService,
      cancellation,
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
