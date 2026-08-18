import {
  CancelRunRequestSchema,
  CreateRunRequestSchema,
  RunPaginationQuerySchema,
} from '@loop/contracts'
import { RunServiceError, type CancellationService, type RunService } from '@loop/execution-runtime'
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
): void => {
  app.post('/api/runs', async (context) => {
    const input = CreateRunRequestSchema.parse(await parseRunBody(context))
    return context.json(await runs.create(input), 201)
  })

  app.get('/api/runs', (context) => {
    const query = RunPaginationQuerySchema.parse({
      page: context.req.query('page'),
      pageSize: context.req.query('pageSize'),
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

  app.get('/api/runs/:runId/nodes/:nodeId/source', (context) =>
    context.json(runs.getNodeSource(context.req.param('runId'), context.req.param('nodeId')), 200),
  )

  app.get('/api/runs/:runId', (context) => {
    const detail = runs.get(context.req.param('runId'))
    if (detail === undefined) {
      throw new RunServiceError('RUN_NOT_FOUND', 'Run was not found')
    }
    return context.json(detail, 200)
  })
}
