import { WorkflowServiceError, type WorkflowService } from '@loop/execution-runtime'
import type { Context, Hono } from 'hono'

const parseRevisionBody = async (context: Context): Promise<unknown> => {
  try {
    return await context.req.json<unknown>()
  } catch (cause) {
    throw new WorkflowServiceError(
      'WORKFLOW_REQUEST_INVALID',
      'Workflow revision request is invalid',
      undefined,
      { cause },
    )
  }
}

export const registerWorkflowRoutes = (app: Hono, workflows: WorkflowService): void => {
  app.get('/api/workflows', (context) => context.json({ workflows: workflows.list() }, 200))

  app.get('/api/workflows/:workflowId/revisions/:revisionId', (context) =>
    context.json(
      workflows.get(context.req.param('workflowId'), context.req.param('revisionId')),
      200,
    ),
  )

  app.post('/api/workflows/:workflowId/revisions', async (context) =>
    context.json(
      await workflows.create(context.req.param('workflowId'), await parseRevisionBody(context)),
      201,
    ),
  )
}
