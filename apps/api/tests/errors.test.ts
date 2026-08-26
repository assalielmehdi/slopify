import { ApiErrorSchema } from '@slopify/contracts'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import { ApiApplicationError, createApiApp, parseJsonBody } from '../src/app.js'

describe('API error boundary', () => {
  it('serializes an explicit domain error with its stable status and details', async () => {
    const app = createApiApp()
    app.get('/domain-error', () => {
      throw new ApiApplicationError({
        status: 409,
        code: 'RUN_CONFLICT',
        message: 'Another run is active',
        details: { runId: 'run-01' },
      })
    })

    const response = await app.request('/domain-error')
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(ApiErrorSchema.parse(body)).toEqual({
      error: {
        code: 'RUN_CONFLICT',
        message: 'Another run is active',
        details: { runId: 'run-01' },
      },
    })
  })

  it('maps Zod failures without reflecting rejected input values', async () => {
    const secretInput = 'secret-invalid-value'
    const app = createApiApp()
    app.post('/validation-error', async (context) => {
      const body: unknown = await context.req.json()
      z.strictObject({ count: z.number().int().positive() }).parse(body)
      return context.body(null, 204)
    })

    const response = await app.request('/validation-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ count: secretInput }),
    })
    const responseBody = await response.text()

    expect(response.status).toBe(400)
    expect(responseBody).not.toContain(secretInput)
    expect(ApiErrorSchema.parse(JSON.parse(responseBody))).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: { issues: [{ code: 'invalid_type', path: ['count'] }] },
      },
    })
  })

  it('maps malformed JSON to the same validation envelope', async () => {
    const app = createApiApp()
    app.post('/malformed-json', async (context) => {
      await parseJsonBody(context)
      return context.body(null, 204)
    })

    const response = await app.request('/malformed-json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid-json',
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' },
    })
  })

  it('hides unexpected exception and sensitive details', async () => {
    const secret = 'private-host-value'
    const app = createApiApp()
    app.get('/unexpected-error', () => {
      throw new Error(`Harness process failed with ${secret}`)
    })

    const response = await app.request('/unexpected-error')
    const responseBody = await response.text()

    expect(response.status).toBe(500)
    expect(responseBody).not.toContain(secret)
    expect(JSON.parse(responseBody)).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' },
    })
  })

  it('uses the same error envelope for unknown routes', async () => {
    const response = await createApiApp().request('/missing')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    })
  })
})
