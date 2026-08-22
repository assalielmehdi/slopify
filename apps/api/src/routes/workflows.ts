import type { WorkflowService } from '@slopify/execution-runtime'
import type { Hono } from 'hono'

export const registerWorkflowRoutes = (app: Hono, workflows: WorkflowService): void => {
  app.get('/api/workflows', (context) => context.json({ workflows: workflows.list() }, 200))

  app.get('/api/workflows/:workflowId', (context) =>
    context.json(workflows.get(context.req.param('workflowId')), 200),
  )
}
