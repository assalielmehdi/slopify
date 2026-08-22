import {
  AddProjectRequestSchema,
  DeletionReceiptSchema,
  ProjectCatalogResponseSchema,
  ProjectSchema,
} from '@slopify/contracts'
import type { ProjectService } from '@slopify/execution-runtime'
import type { Hono } from 'hono'

import { parseJsonBody } from '../api-error.js'

export const registerProjectRoutes = (app: Hono, projects: ProjectService): void => {
  app.get('/api/projects', async (context) =>
    context.json(ProjectCatalogResponseSchema.parse({ projects: await projects.list() }), 200),
  )

  app.post('/api/projects', async (context) => {
    const input = AddProjectRequestSchema.parse(await parseJsonBody(context))
    return context.json(ProjectSchema.parse(await projects.add(input)), 201)
  })

  app.delete('/api/projects/:projectId', async (context) => {
    return context.json(
      DeletionReceiptSchema.parse(await projects.delete(context.req.param('projectId'))),
      200,
    )
  })
}
