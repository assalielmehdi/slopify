import { ApiErrorSchema, HealthResponseSchema, type ApiError } from '@loop/contracts'
import {
  CancellationServiceError,
  ProjectProfileServiceError,
  RunEventFeedError,
  RunServiceError,
  WorkflowServiceError,
  type CancellationService,
  type ProjectProfileService,
  type ReadinessService,
  type RunService,
  type RunEventFeed,
  type WorkbenchDatabase,
  type WorkflowService,
} from '@loop/execution-runtime'
import { Hono, type Context } from 'hono'
import { z } from 'zod'

import { registerProjectProfileRoutes } from './routes/project-profiles.js'
import { registerRunRoutes } from './routes/runs.js'
import { registerRunEventRoutes } from './routes/run-events.js'
import { registerWorkflowRoutes } from './routes/workflows.js'

type ApiApplicationErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503

export class ApiApplicationError extends Error {
  readonly status: ApiApplicationErrorStatus
  readonly code: string
  readonly details?: unknown

  constructor(input: {
    readonly status: ApiApplicationErrorStatus
    readonly code: string
    readonly message: string
    readonly details?: unknown
    readonly cause?: unknown
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'ApiApplicationError'
    this.status = input.status
    this.code = input.code
    if (input.details !== undefined) this.details = input.details
  }
}

export interface CreateApiAppOptions {
  readonly cancellation?: CancellationService
  readonly database?: Pick<WorkbenchDatabase, 'isOpen' | 'status'>
  readonly profiles?: ProjectProfileService
  readonly readiness?: ReadinessService
  readonly runs?: RunService
  readonly eventFeed?: RunEventFeed
  readonly workflows?: WorkflowService
}

export const parseJsonBody = async (context: Context): Promise<unknown> => {
  try {
    return await context.req.json<unknown>()
  } catch (cause) {
    throw new ApiApplicationError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      cause,
    })
  }
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

  if (options.profiles !== undefined && options.readiness !== undefined) {
    registerProjectProfileRoutes(app, {
      profiles: options.profiles,
      readiness: options.readiness,
    })
  }

  if (options.workflows !== undefined) registerWorkflowRoutes(app, options.workflows)
  if (options.runs !== undefined) registerRunRoutes(app, options.runs, options.cancellation)
  if (options.eventFeed !== undefined) registerRunEventRoutes(app, options.eventFeed)

  app.notFound((context) =>
    context.json(errorBody({ code: 'NOT_FOUND', message: 'Route not found' }), 404),
  )

  app.onError((error, context) => {
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
        error.code === 'RUN_ACTIVE'
          ? 409
          : error.code === 'RUN_REQUEST_INVALID'
            ? 400
            : error.code === 'PROFILE_NOT_READY' || error.code === 'TASK_RESOLUTION_FAILED'
              ? 422
              : 404
      return context.json(
        errorBody({
          code: error.code,
          message: error.message,
          ...(error.activeRunId === undefined
            ? {}
            : { details: { activeRunId: error.activeRunId } }),
        }),
        status,
      )
    }
    if (error instanceof WorkflowServiceError) {
      const status =
        error.code === 'WORKFLOW_NOT_FOUND'
          ? 404
          : error.code === 'REVISION_CONFLICT'
            ? 409
            : error.code === 'REVISION_INVALID'
              ? 422
              : 400
      return context.json(
        errorBody({
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        }),
        status,
      )
    }
    if (error instanceof ProjectProfileServiceError) {
      return context.json(
        errorBody({ code: error.code, message: error.message }),
        error.code === 'PROFILE_NOT_FOUND' ? 404 : 400,
      )
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
