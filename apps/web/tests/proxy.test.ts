import { afterEach, describe, expect, it, vi } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import nextConfig from '../next.config'
import { GET, POST, PUT } from '../app/api/[...path]/route'

describe('standalone web configuration', () => {
  it('traces the monorepo into a standalone deployment artifact', () => {
    expect(nextConfig.output).toBe('standalone')
    expect(nextConfig.outputFileTracingRoot).toBe(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
    )
  })
})

describe('same-origin API proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.API_INTERNAL_URL
  })

  it('forwards SSE requests to the internal API without buffering the response', async () => {
    process.env.API_INTERNAL_URL = 'http://api:3001'
    const encoder = new TextEncoder()
    const upstreamResponse = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('id: 12\ndata: first\n\n'))
          controller.enqueue(encoder.encode('id: 13\ndata: second\n\n'))
          controller.close()
        },
      }),
      {
        headers: {
          'cache-control': 'no-cache',
          'content-type': 'text/event-stream',
        },
      },
    )
    const fetchImplementation = vi.fn<typeof fetch>(async () => upstreamResponse)
    vi.stubGlobal('fetch', fetchImplementation)

    const response = await GET(
      new Request('http://web:3000/api/runs/run-01/events?cursor=12', {
        headers: { 'last-event-id': '12' },
      }),
    )

    expect(response).toBe(upstreamResponse)
    const forwardedRequest = fetchImplementation.mock.calls.at(0)?.at(0)
    expect(forwardedRequest).toBeInstanceOf(Request)
    if (!(forwardedRequest instanceof Request)) throw new TypeError('Expected a Request')
    expect(forwardedRequest.url).toBe('http://api:3001/api/runs/run-01/events?cursor=12')
    expect(forwardedRequest.headers.get('last-event-id')).toBe('12')
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    await expect(response.text()).resolves.toBe('id: 12\ndata: first\n\nid: 13\ndata: second\n\n')
  })

  it('forwards JSON mutations and preserves their request body', async () => {
    process.env.API_INTERNAL_URL = 'http://api:3001'
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({ runId: 'run-01' }))
    vi.stubGlobal('fetch', fetchImplementation)

    await POST(
      new Request('http://web:3000/api/runs', {
        body: JSON.stringify({ taskReference: 'LOOP-40' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )

    const forwardedRequest = fetchImplementation.mock.calls.at(0)?.at(0)
    expect(forwardedRequest).toBeInstanceOf(Request)
    if (!(forwardedRequest instanceof Request)) throw new TypeError('Expected a Request')
    expect(forwardedRequest.method).toBe('POST')
    expect(forwardedRequest.headers.get('content-type')).toBe('application/json')
    await expect(forwardedRequest.json()).resolves.toEqual({ taskReference: 'LOOP-40' })
  })

  it('maps the public API health path to the Hono health endpoint', async () => {
    process.env.API_INTERNAL_URL = 'http://api:3001'
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({ status: 'ok' }))
    vi.stubGlobal('fetch', fetchImplementation)

    await GET(new Request('http://web:3000/api/healthz'))

    const forwardedRequest = fetchImplementation.mock.calls.at(0)?.at(0)
    expect(forwardedRequest).toBeInstanceOf(Request)
    if (!(forwardedRequest instanceof Request)) throw new TypeError('Expected a Request')
    expect(forwardedRequest.url).toBe('http://api:3001/healthz')
  })

  it('returns the shared error envelope without leaking connection details', async () => {
    process.env.API_INTERNAL_URL = 'http://api:3001'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('connect ECONNREFUSED api'))),
    )

    const response = await PUT(
      new Request('http://web:3000/api/project-profiles/profile-01', {
        body: '{}',
        method: 'PUT',
      }),
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'API service is unavailable',
      },
    })
  })

  it('rejects an unsafe internal API origin without attempting a request', async () => {
    process.env.API_INTERNAL_URL = 'http://user:secret@api:3001/private'
    const fetchImplementation = vi.fn()
    vi.stubGlobal('fetch', fetchImplementation)

    const response = await GET(new Request('http://web:3000/api/workflows'))

    expect(response.status).toBe(500)
    expect(fetchImplementation).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'PROXY_CONFIGURATION_INVALID',
        message: 'API proxy is not configured correctly',
      },
    })
  })
})
