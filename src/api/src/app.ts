import { ApiErrorSchema, HealthResponseSchema, type ApiError } from '@slopify/shared'
import {
  AgentTraceStoreError,
  GitConnectionServiceError,
  JournalCancellationServiceError,
  JournalCoordinatorError,
  RepositoryServiceError,
  RunEventFeedError,
  ResourceEventFeedError,
  RunServiceError,
  SettingsStoreError,
  WorkflowServiceError,
  type GitConnectionService,
  type FilesystemRunEventFeed,
  type HarnessCatalog,
  type RepositoryService,
  type ResourceEventFeed,
  type SettingsStore,
  type WorkflowDefinitionService,
} from './index.js'
import { Hono, type Context } from 'hono'
import { z } from 'zod'

import { ApiApplicationError } from './api-error.js'
import { registerGitConnectionRoutes } from './routes/git-connections.js'
import { registerHarnessRoutes } from './routes/harnesses.js'
import { registerRepositoryRoutes } from './routes/repositories.js'
import { registerFilesystemRunRoutes, type FilesystemRunRouteServices } from './routes/runs.js'
import { registerRunEventRoutes } from './routes/run-events.js'
import { registerResourceEventRoutes } from './routes/resource-events.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerWorkflowRoutes } from './routes/workflows.js'
import { registerWorkflowScreenRoute } from './routes/workflow-screen.js'

export { ApiApplicationError, parseJsonBody } from './api-error.js'

export interface CreateApiAppOptions {
  readonly filesystemHealth?: FilesystemHealth
  readonly gitConnections?: GitConnectionService
  readonly harnesses?: HarnessCatalog
  readonly repositories?: RepositoryService
  readonly filesystemRuns?: FilesystemRunRouteServices
  readonly settings?: SettingsStore
  readonly eventFeed?: FilesystemRunEventFeed
  readonly resourceEvents?: ResourceEventFeed
  readonly workflows?: WorkflowDefinitionService
}

export interface FilesystemHealth {
  status(): Promise<Readonly<{ owned: boolean; writable: boolean }>>
}

const errorBody = (input: {
  readonly code: string
  readonly message: string
  readonly details?: unknown
}): ApiError =>
  ApiErrorSchema.parse({
    error: {
      code: input.code,
      message: input.message,
      ...(input.details === undefined ? {} : { details: input.details }),
    },
  })

const filesystemUnavailable = (context: Context): Response =>
  context.json(
    errorBody({
      code: 'FILESYSTEM_UNAVAILABLE',
      message: 'Local persistence is unavailable',
    }),
    503,
  )

export const createApiApp = (options: CreateApiAppOptions = {}): Hono => {
  const app = new Hono()

  app.get('/healthz', async (context) => {
    if (options.filesystemHealth === undefined) return filesystemUnavailable(context)
    try {
      const status = await options.filesystemHealth.status()
      if (!status.owned || !status.writable) return filesystemUnavailable(context)
      return context.json(HealthResponseSchema.parse({ status: 'ok' }), 200)
    } catch {
      return filesystemUnavailable(context)
    }
  })

  if (options.repositories !== undefined) registerRepositoryRoutes(app, options.repositories)
  if (options.gitConnections !== undefined) registerGitConnectionRoutes(app, options.gitConnections)
  if (options.harnesses !== undefined) registerHarnessRoutes(app, options.harnesses)
  if (options.workflows !== undefined) registerWorkflowRoutes(app, options.workflows)
  if (
    options.workflows !== undefined &&
    options.harnesses !== undefined &&
    options.repositories !== undefined
  ) {
    registerWorkflowScreenRoute(app, {
      workflows: options.workflows,
      harnesses: options.harnesses,
      repositories: options.repositories,
    })
  }
  if (options.filesystemRuns !== undefined) registerFilesystemRunRoutes(app, options.filesystemRuns)
  if (options.eventFeed !== undefined) registerRunEventRoutes(app, options.eventFeed)
  if (options.resourceEvents !== undefined) registerResourceEventRoutes(app, options.resourceEvents)
  if (options.settings !== undefined) registerSettingsRoutes(app, options.settings)

  app.notFound((context) =>
    context.json(errorBody({ code: 'NOT_FOUND', message: 'Route not found' }), 404),
  )

  app.onError((error, context) => {
    if (error instanceof SettingsStoreError) {
      const status =
        error.code === 'SETTINGS_FILE_INVALID'
          ? 409
          : error.code === 'SETTINGS_REVISION_CONFLICT'
            ? 412
            : 503
      return context.json(errorBody({ code: error.code, message: error.message }), status)
    }
    if (error instanceof GitConnectionServiceError) {
      const status =
        error.code === 'GIT_CONNECTION_INVALID'
          ? 401
          : error.code === 'GIT_CONNECTION_NOT_FOUND'
            ? 404
            : error.code === 'GIT_PROVIDER_UNAVAILABLE'
              ? 503
              : 409
      return context.json(errorBody({ code: error.code, message: error.message }), status)
    }
    if (error instanceof AgentTraceStoreError) {
      const status = error.code === 'TRACE_NOT_FOUND' ? 404 : 400
      return context.json(errorBody({ code: error.code, message: error.message }), status)
    }
    if (error instanceof JournalCancellationServiceError) {
      return context.json(errorBody({ code: error.code, message: error.message }), 409)
    }
    if (error instanceof JournalCoordinatorError) {
      const status =
        error.code === 'RUN_NOT_FOUND'
          ? 404
          : error.code === 'WORKFLOW_NOT_RUNNABLE'
            ? 422
            : error.code === 'JOURNAL_RECONCILE_LIMIT_EXCEEDED'
              ? 503
              : 409
      return context.json(errorBody({ code: error.code, message: error.message }), status)
    }
    if (error instanceof RunEventFeedError) {
      const status =
        error.code === 'RUN_NOT_FOUND' ? 404 : error.code === 'RUN_JOURNAL_CORRUPT' ? 409 : 400
      return context.json(errorBody({ code: error.code, message: error.message }), status)
    }
    if (error instanceof ResourceEventFeedError) {
      return context.json(errorBody({ code: error.code, message: error.message }), 400)
    }
    if (error instanceof RunServiceError) {
      const status =
        error.code === 'RUN_ADMISSION_CLOSED'
          ? 503
          : error.code === 'WORKFLOW_REPOSITORY_UNAVAILABLE' ||
              error.code === 'WORKFLOW_HARNESS_UNAVAILABLE'
            ? 409
            : error.code === 'RUN_REQUEST_INVALID' || error.code === 'RUN_VARIABLES_INVALID'
              ? 400
              : error.code === 'WORKFLOW_NOT_RUNNABLE'
                ? 422
                : 404
      return context.json(errorBody({ code: error.code, message: error.message }), status)
    }
    if (error instanceof WorkflowServiceError) {
      const status =
        error.code === 'WORKFLOW_NOT_FOUND'
          ? 404
          : error.code === 'WORKFLOW_HARNESS_UNAVAILABLE' || error.code === 'WORKFLOW_FILE_INVALID'
            ? 422
            : error.code === 'WORKFLOW_REVISION_CONFLICT'
              ? 412
              : error.code === 'WORKFLOW_UNAVAILABLE'
                ? 503
                : 409
      return context.json(errorBody({ code: error.code, message: error.message }), status)
    }
    if (error instanceof RepositoryServiceError) {
      const status =
        error.code === 'REPOSITORY_NOT_FOUND'
          ? 404
          : error.code === 'REPOSITORY_REMOTE_CONFLICT'
            ? 409
            : error.code === 'REPOSITORY_CONNECTION_REQUIRED' ||
                error.code === 'REPOSITORY_UNAVAILABLE'
              ? 422
              : error.code === 'REPOSITORY_REMOTE_NOT_FOUND'
                ? 404
                : 400
      return context.json(errorBody({ code: error.code, message: error.message }), status)
    }
    if (error instanceof ApiApplicationError) {
      return context.json(
        errorBody({
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        }),
        error.status,
      )
    }
    if (error instanceof z.ZodError) {
      return context.json(
        errorBody({
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: {
            issues: error.issues.map((issue) => ({ code: issue.code, path: issue.path })),
          },
        }),
        400,
      )
    }
    return context.json(
      errorBody({ code: 'INTERNAL_ERROR', message: 'Unexpected server error' }),
      500,
    )
  })

  return app
}
