import { CredentialSchema, type ConnectionService } from '@loop/execution-runtime'
import type { ChatGptOAuthService } from '@loop/agent-runtimes'
import type { Hono } from 'hono'
import { z } from 'zod'

import { parseJsonBody } from '../api-error.js'

const ConnectSchema = z.strictObject({
  connectionId: z.string().trim().min(1).max(128).optional(),
  type: z.enum(['gitlab', 'clickup', 'openrouter']),
  label: z.string().trim().min(1).max(128),
  configuration: z.unknown(),
  credential: CredentialSchema,
})
const ReplaceCredentialSchema = z.strictObject({ credential: CredentialSchema })

export const registerConnectionRoutes = (
  app: Hono,
  connections: ConnectionService,
  chatGptOAuth?: ChatGptOAuthService,
): void => {
  app.get('/api/connections', (context) => context.json({ connections: connections.list() }, 200))
  app.post('/api/connections', async (context) => {
    const input = ConnectSchema.parse(await parseJsonBody(context))
    return context.json(
      await connections.connect({
        type: input.type,
        label: input.label,
        configuration: input.configuration,
        credential: input.credential,
        ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
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
      const input = z
        .strictObject({ label: z.string().trim().min(1).max(128) })
        .parse(await parseJsonBody(context))
      return context.json(chatGptOAuth.start(input), 202)
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
