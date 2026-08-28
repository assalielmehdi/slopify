import {
  ResourceRevisionSchema,
  type ResourceRevision,
  type WorkflowDefinitionCatalogEntry,
  type WorkflowDefinitionService,
  type WorkflowSource,
} from '@slopify/execution-runtime'
import type { Context, Hono } from 'hono'

import { ApiApplicationError, parseJsonBody } from '../api-error.js'

const MISSING_ETAG = '"missing"'

const etag = (revision: ResourceRevision | null): string =>
  revision === null ? MISSING_ETAG : `"${revision}"`

const expectedRevision = (header: string | undefined): ResourceRevision | null => {
  if (header === undefined) {
    throw new ApiApplicationError({
      status: 428,
      code: 'WORKFLOW_PRECONDITION_REQUIRED',
      message: 'If-Match is required when updating a workflow',
    })
  }
  if (header === MISSING_ETAG) return null
  const match = /^"([a-f0-9]{64})"$/u.exec(header)
  if (match?.[1] === undefined) {
    throw new ApiApplicationError({
      status: 400,
      code: 'WORKFLOW_ETAG_INVALID',
      message: 'If-Match must contain one current workflow ETag',
    })
  }
  return ResourceRevisionSchema.parse(match[1])
}

const jsonWithEtag = (
  context: Context,
  body: WorkflowDefinitionCatalogEntry | WorkflowSource,
  status: 200 | 201,
): Response => {
  context.header('ETag', etag(body.revision))
  context.header('Cache-Control', 'no-store')
  return context.json(body, status)
}

export const registerWorkflowRoutes = (app: Hono, workflows: WorkflowDefinitionService): void => {
  app.get('/api/workflows', async (context) => {
    context.header('Cache-Control', 'no-store')
    return context.json({ workflows: await workflows.list() }, 200)
  })

  app.post('/api/workflows', async (context) => {
    const created = await workflows.create(await parseJsonBody(context))
    return jsonWithEtag(context, created, 201)
  })

  app.delete('/api/workflows/:workflowId', async (context) => {
    await workflows.delete(context.req.param('workflowId'))
    return context.body(null, 204)
  })

  app.get('/api/workflows/:workflowId/source', async (context) =>
    jsonWithEtag(context, await workflows.getSource(context.req.param('workflowId')), 200),
  )

  app.get('/api/workflows/:workflowId', async (context) =>
    jsonWithEtag(context, await workflows.get(context.req.param('workflowId')), 200),
  )

  app.put('/api/workflows/:workflowId', async (context) => {
    const updated = await workflows.update(context.req.param('workflowId'), {
      value: await parseJsonBody(context),
      expectedRevision: expectedRevision(context.req.header('if-match')),
    })
    return jsonWithEtag(context, updated, 200)
  })
}
