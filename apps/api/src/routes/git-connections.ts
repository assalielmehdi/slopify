import {
  ConfigureGitConnectionRequestSchema,
  GitConnectionCatalogResponseSchema,
  GitConnectionSchema,
  GitRepositoryCatalogResponseSchema,
} from '@slopify/shared'
import type { GitConnectionService } from '@slopify/execution-runtime'
import type { Hono } from 'hono'

import { parseJsonBody } from '../api-error.js'

export const registerGitConnectionRoutes = (app: Hono, connections: GitConnectionService): void => {
  app.get('/api/git/connections', async (context) =>
    context.json(
      GitConnectionCatalogResponseSchema.parse({ connections: await connections.list() }),
      200,
    ),
  )

  app.put('/api/git/connections/:provider', async (context) => {
    const input = ConfigureGitConnectionRequestSchema.parse(await parseJsonBody(context))
    return context.json(
      GitConnectionSchema.parse(await connections.configure(context.req.param('provider'), input)),
      200,
    )
  })

  app.delete('/api/git/connections/:provider', async (context) => {
    await connections.disconnect(context.req.param('provider'))
    return context.body(null, 204)
  })

  app.get('/api/git/connections/:provider/repositories', async (context) =>
    context.json(
      GitRepositoryCatalogResponseSchema.parse({
        repositories: await connections.listRepositories(context.req.param('provider')),
      }),
      200,
    ),
  )
}
