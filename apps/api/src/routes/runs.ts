import { CreateRunRequestSchema, RunPaginationQuerySchema } from '@loop/contracts'
import { RunServiceError, type RunService } from '@loop/execution-runtime'
import type { Context, Hono } from 'hono'

const parseRunBody = async (context: Context): Promise<unknown> => {
  try {
    return await context.req.json<unknown>()
  } catch (cause) {
    throw new RunServiceError('RUN_REQUEST_INVALID', 'Run request is invalid', { cause })
  }
}

export const registerRunRoutes = (app: Hono, runs: RunService): void => {
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
