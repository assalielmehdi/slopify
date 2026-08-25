import type { WorkflowService } from '@slopify/execution-runtime'
import type { Hono } from 'hono'

import { parseJsonBody } from '../api-error.js'

export const registerWorkflowRoutes = (app: Hono, workflows: WorkflowService): void => {
  app.get('/api/workflows', (context) => context.json({ workflows: workflows.list() }, 200))

  app.post('/api/workflows', async (context) =>
    context.json(workflows.create(await parseJsonBody(context)), 201),
  )

  app.get('/api/workflows/:workflowId', (context) =>
    context.json(workflows.get(context.req.param('workflowId')), 200),
  )

  app.put('/api/workflows/:workflowId', async (context) =>
    context.json(
      await workflows.update(context.req.param('workflowId'), await parseJsonBody(context)),
      200,
    ),
  )
}
