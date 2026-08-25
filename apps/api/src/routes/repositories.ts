import {
  AddRepositoryRequestSchema,
  RepositoryCatalogResponseSchema,
  RepositorySchema,
} from '@slopify/contracts'
import type { RepositoryService } from '@slopify/execution-runtime'
import type { Hono } from 'hono'

import { parseJsonBody } from '../api-error.js'

const registerRepositoryPath = (
  app: Hono,
  repositories: RepositoryService,
  path: '/api/repositories' | '/api/projects',
): void => {
  app.get(path, async (context) =>
    context.json(
      RepositoryCatalogResponseSchema.parse({ repositories: await repositories.list() }),
      200,
    ),
  )

  app.post(path, async (context) => {
    const input = AddRepositoryRequestSchema.parse(await parseJsonBody(context))
    return context.json(RepositorySchema.parse(await repositories.add(input)), 201)
  })

  app.delete(`${path}/:repositoryId`, async (context) => {
    await repositories.delete(context.req.param('repositoryId'))
    return context.body(null, 204)
  })
}

export const registerRepositoryRoutes = (app: Hono, repositories: RepositoryService): void => {
  registerRepositoryPath(app, repositories, '/api/repositories')
  registerRepositoryPath(app, repositories, '/api/projects')
}
