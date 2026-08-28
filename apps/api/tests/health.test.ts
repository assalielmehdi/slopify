import { describe, expect, it } from 'vitest'

import { createApiApp } from '../src/app.js'

describe('GET /healthz', () => {
  it('ignores unrelated request headers', async () => {
    const response = await createApiApp({
      filesystemHealth: { status: async () => ({ owned: true, writable: true }) },
    }).request('/healthz', { headers: { authorization: 'Bearer absent-from-runtime' } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('reports healthy filesystem ownership and writability', async () => {
    const response = await createApiApp({
      filesystemHealth: { status: async () => ({ owned: true, writable: true }) },
    }).request('/healthz')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('does not expose filesystem paths when ownership or writability is lost', async () => {
    const privatePath = '/Users/operator/.slopify/runtime/instance.lock'
    const response = await createApiApp({
      filesystemHealth: {
        status: async () => {
          throw new Error(privatePath)
        },
      },
    }).request('/healthz')
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(body).not.toContain(privatePath)
    expect(JSON.parse(body)).toEqual({
      error: { code: 'FILESYSTEM_UNAVAILABLE', message: 'Local persistence is unavailable' },
    })
  })
})
