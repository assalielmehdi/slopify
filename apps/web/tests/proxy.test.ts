import { afterEach, describe, expect, it, vi } from 'vitest'

import nextConfig from '../next.config'
import { GET, PATCH, POST, PUT } from '../app/api/[...path]/route'

describe('web configuration', () => {
  it('keeps build-time type checking delegated to the TypeScript CLI', () => {
    expect(nextConfig).toEqual({
      agentRules: false,
      typescript: { ignoreBuildErrors: true },
    })
  })
})

describe('same-origin API proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.API_INTERNAL_URL
  })

  it('forwards SSE requests to the internal API without buffering the response', async () => {
    process.env.API_INTERNAL_URL = 'http://127.0.0.1:4311'
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
      new Request('http://127.0.0.1:7310/api/runs/run-01/events?cursor=12', {
        headers: { 'last-event-id': '12' },
      }),
    )

    expect(response).toBe(upstreamResponse)
    const forwardedRequest = fetchImplementation.mock.calls.at(0)?.at(0)
    expect(forwardedRequest).toBeInstanceOf(Request)
    if (!(forwardedRequest instanceof Request)) throw new TypeError('Expected a Request')
    expect(forwardedRequest.url).toBe('http://127.0.0.1:4311/api/runs/run-01/events?cursor=12')
    expect(forwardedRequest.headers.get('last-event-id')).toBe('12')
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    await expect(response.text()).resolves.toBe('id: 12\ndata: first\n\nid: 13\ndata: second\n\n')
  })

  it('forwards JSON mutations and preserves their request body', async () => {
    process.env.API_INTERNAL_URL = 'http://127.0.0.1:4311'
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({ runId: 'run-01' }))
    vi.stubGlobal('fetch', fetchImplementation)

    await POST(
      new Request('http://127.0.0.1:7310/api/runs', {
        body: JSON.stringify({
          workflowId: 'default-workflow',
          variables: { task: 'SLOPIFY-40' },
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )

    const forwardedRequest = fetchImplementation.mock.calls.at(0)?.at(0)
    expect(forwardedRequest).toBeInstanceOf(Request)
    if (!(forwardedRequest instanceof Request)) throw new TypeError('Expected a Request')
    expect(forwardedRequest.method).toBe('POST')
    expect(forwardedRequest.headers.get('content-type')).toBe('application/json')
    await expect(forwardedRequest.json()).resolves.toEqual({
      workflowId: 'default-workflow',
      variables: { task: 'SLOPIFY-40' },
    })
  })

  it('forwards settings preconditions on PATCH requests', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ appearance: { theme: 'dark' } }, { headers: { etag: '"next"' } }),
    )
    vi.stubGlobal('fetch', fetchImplementation)

    await PATCH(
      new Request('http://127.0.0.1:7310/api/settings', {
        body: JSON.stringify({ appearance: { theme: 'dark' } }),
        headers: { 'content-type': 'application/json', 'if-match': '"current"' },
        method: 'PATCH',
      }),
    )

    const forwardedRequest = fetchImplementation.mock.calls.at(0)?.at(0)
    expect(forwardedRequest).toBeInstanceOf(Request)
    if (!(forwardedRequest instanceof Request)) throw new TypeError('Expected a Request')
    expect(forwardedRequest.method).toBe('PATCH')
    expect(forwardedRequest.headers.get('if-match')).toBe('"current"')
    await expect(forwardedRequest.json()).resolves.toEqual({ appearance: { theme: 'dark' } })
  })

  it('maps the public API health path to the Hono health endpoint', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({ status: 'ok' }))
    vi.stubGlobal('fetch', fetchImplementation)

    await GET(new Request('http://127.0.0.1:7310/api/healthz'))

    const forwardedRequest = fetchImplementation.mock.calls.at(0)?.at(0)
    expect(forwardedRequest).toBeInstanceOf(Request)
    if (!(forwardedRequest instanceof Request)) throw new TypeError('Expected a Request')
    expect(forwardedRequest.url).toBe('http://127.0.0.1:7311/healthz')
  })

  it('returns the shared error envelope when the API is unavailable', async () => {
    process.env.API_INTERNAL_URL = 'http://127.0.0.1:4311'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:4311'))),
    )

    const response = await PUT(
      new Request('http://127.0.0.1:7310/api/workflows/default-workflow', {
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
    process.env.API_INTERNAL_URL = 'http://user:secret@127.0.0.1:4311/private'
    const fetchImplementation = vi.fn()
    vi.stubGlobal('fetch', fetchImplementation)

    const response = await GET(new Request('http://127.0.0.1:7310/api/workflows'))

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
