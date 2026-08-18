import { pathToFileURL } from 'node:url'
import { serve, type ServerType } from '@hono/node-server'
import { ConnectorStatusSchema, type ConnectorStatus } from '@loop/contracts'
import {
  createProcessRunner,
  createProfileRepository,
  createProjectProfileService,
  createReadinessService,
  openDatabase,
} from '@loop/execution-runtime'
import type { Hono } from 'hono'

import { createApiApp } from './app.js'

export type ServerConfigurationErrorCode =
  'API_CONTAINER_MODE_INVALID' | 'API_HOST_INVALID' | 'API_PORT_INVALID' | 'DATABASE_PATH_INVALID'

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
}

type ApiEnvironment = Readonly<Record<string, string | undefined>>

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

export const resolveApiServerConfiguration = (
  environment: ApiEnvironment = process.env,
): ApiServerConfiguration => {
  const isContainer = containerMode(environment.API_CONTAINER_MODE)
  return {
    hostname: nonBlank(
      environment.API_HOST,
      isContainer ? '0.0.0.0' : '127.0.0.1',
      'API_HOST_INVALID',
    ),
    port: port(environment.API_PORT),
    databasePath: nonBlank(
      environment.DATABASE_PATH,
      './data/workbench.sqlite',
      'DATABASE_PATH_INVALID',
    ),
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

export const startApiServer = (input: {
  readonly app: Hono
  readonly configuration: ApiServerConfiguration
}): ServerType =>
  serve({
    fetch: input.app.fetch,
    hostname: input.configuration.hostname,
    port: input.configuration.port,
  })

export const startConfiguredApiServer = (environment: ApiEnvironment = process.env): ServerType => {
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

  const profileService = createProjectProfileService({
    profiles: createProfileRepository(database),
    runtimeMode: containerMode(environment.API_CONTAINER_MODE) ? 'container' : 'native',
    workspaceRoot: environment.WORKSPACE_ROOT ?? '/workspace',
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
  return startApiServer({
    app: createApiApp({ database, profiles: profileService, readiness }),
    configuration,
  })
}

const executable = process.argv[1]
if (executable !== undefined && pathToFileURL(executable).href === import.meta.url) {
  startConfiguredApiServer()
}
