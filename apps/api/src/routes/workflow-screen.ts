import { WorkflowIdSchema } from '@slopify/contracts'
import type {
  HarnessCatalog,
  RepositoryService,
  WorkflowDefinitionService,
} from '@slopify/execution-runtime'
import type { Hono } from 'hono'

export const registerWorkflowScreenRoute = (
  app: Hono,
  services: Readonly<{
    workflows: WorkflowDefinitionService
    harnesses: HarnessCatalog
    repositories: RepositoryService
  }>,
): void => {
  app.get('/api/screens/workflow', async (context) => {
    const requestedWorkflowId = WorkflowIdSchema.optional().parse(context.req.query('workflowId'))
    const [workflows, harnesses, repositories] = await Promise.all([
      services.workflows.list(),
      services.harnesses.list(),
      services.repositories.list(),
    ])
    const validWorkflows = workflows.filter(({ status }) => status === 'VALID')
    const selectedWorkflow =
      validWorkflows.find(({ workflowId }) => workflowId === requestedWorkflowId) ??
      validWorkflows[0]

    context.header('Cache-Control', 'no-store')
    return context.json(
      {
        workflows,
        selectedWorkflowId: selectedWorkflow?.workflowId ?? null,
        harnesses,
        repositories,
      },
      200,
    )
  })
}
