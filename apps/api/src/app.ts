import { ApiErrorSchema, HealthResponseSchema, type ApiError } from '@loop/contracts'
import type { ChatGptOAuthService } from '@loop/agent-runtimes'
import {
  CancellationServiceError,
  ConnectionServiceError,
  ProjectServiceError,
  RunEventFeedError,
  RunServiceError,
  SkillCatalogError,
  WorkflowServiceError,
  type CancellationService,
  type ConnectionCatalog,
  type ConnectionService,
  type ProjectService,
  type RunService,
  type RunEventFeed,
  type SkillCatalog,
  type WorkbenchDatabase,
  type WorkflowService,
} from '@loop/execution-runtime'
import { Hono, type Context } from 'hono'
import { z } from 'zod'

import { ApiApplicationError } from './api-error.js'
import { registerConnectionRoutes } from './routes/connections.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerRunRoutes } from './routes/runs.js'
import { registerRunEventRoutes } from './routes/run-events.js'
import { registerSkillRoutes } from './routes/skills.js'
import { registerWorkflowRoutes } from './routes/workflows.js'

export { ApiApplicationError, parseJsonBody } from './api-error.js'

export interface CreateApiAppOptions {
  readonly cancellation?: CancellationService
  readonly connectionCatalog?: ConnectionCatalog
  readonly connections?: ConnectionService
  readonly chatGptOAuth?: ChatGptOAuthService
  readonly database?: Pick<WorkbenchDatabase, 'isOpen' | 'status'>
  readonly projects?: ProjectService
  readonly runs?: RunService
  readonly skills?: SkillCatalog
  readonly eventFeed?: RunEventFeed
  readonly workflows?: WorkflowService
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

const persistenceUnavailable = (context: Context): Response =>
  context.json(
    errorBody({
      code: 'DATABASE_UNAVAILABLE',
      message: 'Local persistence is unavailable',
    }),
    503,
  )

export const createApiApp = (options: CreateApiAppOptions): Hono => {
  const app = new Hono()

  app.get('/healthz', (context) => {
    if (options.database?.isOpen !== true) return persistenceUnavailable(context)

    try {
      if (!options.database.status().writable) return persistenceUnavailable(context)
      return context.json(HealthResponseSchema.parse({ status: 'ok' }), 200)
    } catch {
      return persistenceUnavailable(context)
    }
  })

  if (options.projects !== undefined) registerProjectRoutes(app, options.projects)
  if (options.workflows !== undefined) registerWorkflowRoutes(app, options.workflows)
  if (options.runs !== undefined) registerRunRoutes(app, options.runs, options.cancellation)
  if (options.eventFeed !== undefined) registerRunEventRoutes(app, options.eventFeed)
  if (options.skills !== undefined) registerSkillRoutes(app, options.skills)
  if (options.connections !== undefined && options.connectionCatalog !== undefined)
    registerConnectionRoutes(
      app,
      options.connections,
      options.connectionCatalog,
      options.chatGptOAuth,
    )

  app.notFound((context) =>
    context.json(errorBody({ code: 'NOT_FOUND', message: 'Route not found' }), 404),
  )

  app.onError((error, context) => {
    if (error instanceof SkillCatalogError) {
      const status =
        error.code === 'SKILL_NOT_FOUND'
          ? 404
          : error.code === 'SKILL_CONFLICT'
            ? 409
            : error.code === 'SKILL_LIMIT_EXCEEDED'
              ? 413
              : 400
      return context.json(errorBody({ code: error.code, message: error.message }), status)
    }
    if (error instanceof ConnectionServiceError) {
      const status =
        error.code === 'CONNECTION_NOT_FOUND'
          ? 404
          : error.code === 'CONNECTION_VALIDATION_FAILED'
            ? 422
            : error.code === 'CREDENTIAL_NOT_FOUND'
              ? 409
              : 400
      return context.json(errorBody({ code: error.code, message: error.message }), status)
    }
    if (error instanceof CancellationServiceError) {
      return context.json(
        errorBody({ code: error.code, message: error.message }),
        error.code === 'RUN_NOT_FOUND' ? 404 : 409,
      )
    }
    if (error instanceof RunEventFeedError) {
      return context.json(
        errorBody({ code: error.code, message: error.message }),
        error.code === 'RUN_NOT_FOUND' ? 404 : 400,
      )
    }
    if (error instanceof RunServiceError) {
      const status =
        error.code === 'RUN_ADMISSION_CLOSED'
          ? 503
          : error.code === 'RUN_ACTIVE' || error.code === 'RUN_VARIABLES_MISSING'
            ? 409
            : error.code === 'RUN_REQUEST_INVALID'
              ? 400
              : error.code === 'WORKFLOW_NOT_RUNNABLE'
                ? 422
                : 404
      return context.json(
        errorBody({
          code: error.code,
          message: error.message,
          ...(error.missingVariables !== undefined
            ? { details: { missingVariables: error.missingVariables } }
            : error.activeRunId === undefined
              ? {}
              : { details: { activeRunId: error.activeRunId } }),
        }),
        status,
      )
    }
    if (error instanceof WorkflowServiceError) {
      return context.json(errorBody({ code: error.code, message: error.message }), 404)
    }
    if (error instanceof ProjectServiceError) {
      const status =
        error.code === 'PROJECT_NOT_FOUND'
          ? 404
          : error.code === 'PROJECT_PATH_CONFLICT'
            ? 409
            : error.code === 'PROJECT_PATH_NOT_FOUND' ||
                error.code === 'PROJECT_NOT_GIT_REPOSITORY' ||
                error.code === 'PROJECT_UNAVAILABLE'
              ? 422
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
