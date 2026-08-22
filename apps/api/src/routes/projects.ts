import {
  AddProjectRequestSchema,
  ProjectCatalogResponseSchema,
  ProjectSchema,
} from '@loop/contracts'
import type { ProjectService } from '@loop/execution-runtime'
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
    await projects.delete(context.req.param('projectId'))
    return context.body(null, 204)
  })
}
