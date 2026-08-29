import { describe, expect, it } from 'vitest'

import { GET } from '../app/healthz/route'

describe('web health route', () => {
  it('reports only Next.js process health without caching the result', async () => {
    const response = GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })
})
