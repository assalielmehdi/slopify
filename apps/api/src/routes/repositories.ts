import {
  AddRepositoryRequestSchema,
  DeletionReceiptSchema,
  RepositoryCatalogResponseSchema,
  RepositorySchema,
} from '@slopify/contracts'
import type { RepositoryService } from '@slopify/execution-runtime'
import type { Hono } from 'hono'

import { parseJsonBody } from '../api-error.js'

export const registerRepositoryRoutes = (app: Hono, repositories: RepositoryService): void => {
  app.get('/api/repositories', async (context) =>
    context.json(
      RepositoryCatalogResponseSchema.parse({ repositories: await repositories.list() }),
      200,
    ),
  )

  app.post('/api/repositories', async (context) => {
    const input = AddRepositoryRequestSchema.parse(await parseJsonBody(context))
    return context.json(RepositorySchema.parse(await repositories.add(input)), 201)
  })

  app.delete('/api/repositories/:repositoryId', async (context) => {
    return context.json(
      DeletionReceiptSchema.parse(await repositories.delete(context.req.param('repositoryId'))),
      200,
    )
  })
}
