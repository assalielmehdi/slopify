import { HarnessCatalogResponseSchema } from '@slopify/shared'
import type { HarnessCatalog } from '@slopify/execution-runtime'
import type { Hono } from 'hono'

export const registerHarnessRoutes = (app: Hono, harnesses: HarnessCatalog): void => {
  app.get('/api/harnesses', async (context) =>
    context.json(HarnessCatalogResponseSchema.parse({ harnesses: await harnesses.list() }), 200),
  )
}
