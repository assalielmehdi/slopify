import { UndoDeletionResponseSchema } from '@slopify/contracts'
import type { DeletionService } from '@slopify/execution-runtime'
import type { Hono } from 'hono'

export const registerDeletionRoutes = (app: Hono, deletions: DeletionService): void => {
  app.post('/api/deletions/:deletionId/undo', async (context) =>
    context.json(
      UndoDeletionResponseSchema.parse(await deletions.undo(context.req.param('deletionId'))),
      200,
    ),
  )
}
