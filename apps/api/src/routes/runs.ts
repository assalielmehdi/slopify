import {
  CancelRunRequestSchema,
  CreateRunRequestSchema,
  RunPaginationQuerySchema,
} from '@slopify/contracts'
import {
  AgentTraceStoreError,
  RunServiceError,
  type AgentTraceStore,
  type CancellationService,
  type FilesystemRunAdmissionService,
  type FilesystemRunIndex,
  type FilesystemRunReader,
  type RunService,
} from '@slopify/execution-runtime'
import type { Context, Hono } from 'hono'

const parseRunBody = async (context: Context): Promise<unknown> => {
  try {
    return await context.req.json<unknown>()
  } catch (cause) {
    throw new RunServiceError('RUN_REQUEST_INVALID', 'Run request is invalid', { cause })
  }
}

const parseOptionalRunBody = async (context: Context): Promise<unknown> => {
  try {
    const body = await context.req.text()
    return body.trim() === '' ? {} : (JSON.parse(body) as unknown)
  } catch (cause) {
    throw new RunServiceError('RUN_REQUEST_INVALID', 'Run request is invalid', { cause })
  }
}

export const registerRunRoutes = (
  app: Hono,
  runs: RunService,
  cancellation?: CancellationService,
  traces?: AgentTraceStore,
): void => {
  app.post('/api/runs', async (context) => {
    const input = CreateRunRequestSchema.parse(await parseRunBody(context))
    return context.json(await runs.create(input), 201)
  })

  app.get('/api/runs', (context) => {
    const query = RunPaginationQuerySchema.parse({
      page: context.req.query('page'),
      pageSize: context.req.query('pageSize'),
      runId: context.req.query('runId'),
      statuses: context.req.queries('status'),
      startedFrom: context.req.query('startedFrom'),
      startedTo: context.req.query('startedTo'),
      durationMinMs: context.req.query('durationMinMs'),
      durationMaxMs: context.req.query('durationMaxMs'),
    })
    return context.json(runs.list(query), 200)
  })

  if (cancellation !== undefined) {
    app.post('/api/runs/:runId/cancel', async (context) => {
      const input = CancelRunRequestSchema.parse(await parseOptionalRunBody(context))
      return context.json(
        await cancellation.cancel({
          runId: context.req.param('runId'),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        }),
        200,
      )
    })
  }

  app.get('/api/runs/:runId', (context) => {
    const detail = runs.get(context.req.param('runId'))
    if (detail === undefined) {
      throw new RunServiceError('RUN_NOT_FOUND', 'Run was not found')
    }
    return context.json(detail, 200)
  })

  if (traces !== undefined) {
    app.get('/api/runs/:runId/node-executions/:nodeExecutionId/trace', async (context) => {
      const runId = context.req.param('runId')
      const nodeExecutionId = context.req.param('nodeExecutionId')
      const attemptId = context.req.query('attemptId')
      const detail = runs.get(runId)
      const execution = detail?.nodeExecutions.find(
        (candidate) =>
          candidate.nodeExecutionId === nodeExecutionId && candidate.attemptId === attemptId,
      )
      if (execution === undefined || attemptId === undefined) {
        throw new AgentTraceStoreError('TRACE_NOT_FOUND', 'Agent trace was not found')
      }
      return context.json(await traces.read({ runId, nodeExecutionId, attemptId }), 200)
    })
  }
}

export interface FilesystemRunRouteServices {
  readonly admissions: FilesystemRunAdmissionService
  readonly index: Pick<FilesystemRunIndex, 'list'>
  readonly reader: Pick<FilesystemRunReader, 'get'>
}

export const registerFilesystemRunRoutes = (
  app: Hono,
  services: FilesystemRunRouteServices,
): void => {
  app.post('/api/runs', async (context) => {
    const input = CreateRunRequestSchema.parse(await parseRunBody(context))
    return context.json(await services.admissions.create(input), 202)
  })

  app.get('/api/runs', async (context) => {
    const query = RunPaginationQuerySchema.parse({
      page: context.req.query('page'),
      pageSize: context.req.query('pageSize'),
      runId: context.req.query('runId'),
      statuses: context.req.queries('status'),
      startedFrom: context.req.query('startedFrom'),
      startedTo: context.req.query('startedTo'),
      durationMinMs: context.req.query('durationMinMs'),
      durationMaxMs: context.req.query('durationMaxMs'),
    })
    return context.json(await services.index.list(query), 200)
  })

  app.get('/api/runs/:runId', async (context) => {
    const detail = await services.reader.get(context.req.param('runId'))
    if (detail === undefined) {
      throw new RunServiceError('RUN_NOT_FOUND', 'Run was not found')
    }
    return context.json(detail, 200)
  })
}
