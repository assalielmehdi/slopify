import {
  CredentialSchema,
  type ConnectionCatalog,
  type ConnectionService,
} from '@slopify/execution-runtime'
import type { ChatGptOAuthService } from '@slopify/agent-runtimes'
import type { Hono } from 'hono'
import { z } from 'zod'

import { parseJsonBody } from '../api-error.js'

const ConnectSchema = z.strictObject({
  type: z.enum(['gitlab', 'clickup', 'openrouter']),
  configuration: z.unknown(),
  credential: CredentialSchema,
})
const ReplaceCredentialSchema = z.strictObject({ credential: CredentialSchema })

export const registerConnectionRoutes = (
  app: Hono,
  connections: ConnectionService,
  catalog: ConnectionCatalog,
  chatGptOAuth?: ChatGptOAuthService,
): void => {
  app.get('/api/connections', (context) =>
    context.json({ catalog: catalog.list(), connections: connections.list() }, 200),
  )
  app.post('/api/connections', async (context) => {
    const input = ConnectSchema.parse(await parseJsonBody(context))
    return context.json(
      await connections.connect({
        type: input.type,
        configuration: input.configuration,
        credential: input.credential,
      }),
      201,
    )
  })
  app.post('/api/connections/:connectionId/revalidate', async (context) =>
    context.json(await connections.revalidate(context.req.param('connectionId')), 200),
  )
  app.put('/api/connections/:connectionId/credential', async (context) => {
    const input = ReplaceCredentialSchema.parse(await parseJsonBody(context))
    return context.json(
      await connections.replaceCredential(context.req.param('connectionId'), input.credential),
      200,
    )
  })
  app.delete('/api/connections/:connectionId', async (context) => {
    await connections.disconnect(context.req.param('connectionId'))
    return context.body(null, 204)
  })
  if (chatGptOAuth !== undefined) {
    app.post('/api/connections/chatgpt/oauth', async (context) => {
      z.strictObject({}).parse(await parseJsonBody(context))
      const entry = catalog.list().find(({ type }) => type === 'chatgpt-subscription')
      if (entry === undefined) throw new Error('ChatGPT is absent from the connection catalog')
      return context.json(chatGptOAuth.start({ label: entry.name }), 202)
    })
    app.get('/api/connections/chatgpt/oauth/:transactionId', (context) => {
      const transaction = chatGptOAuth.get(context.req.param('transactionId'))
      return transaction === undefined
        ? context.json(
            { error: { code: 'NOT_FOUND', message: 'OAuth transaction not found' } },
            404,
          )
        : context.json(transaction, 200)
    })
    app.delete('/api/connections/chatgpt/oauth/:transactionId', (context) => {
      const cancelled = chatGptOAuth.cancel(context.req.param('transactionId'))
      return context.body(null, cancelled ? 204 : 409)
    })
  }
}
