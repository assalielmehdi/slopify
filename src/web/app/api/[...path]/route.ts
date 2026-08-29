import { DEFAULT_API_INTERNAL_URL, internalApiOrigin } from '@/lib/api-origin'

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json({ error: { code, message } }, { status })

const upstreamPath = (requestUrl: URL): string =>
  requestUrl.pathname === '/api/healthz'
    ? `/healthz${requestUrl.search}`
    : `${requestUrl.pathname}${requestUrl.search}`

const proxyRequest = async (request: Request): Promise<Response> => {
  let origin: string
  try {
    origin = internalApiOrigin()
  } catch {
    return errorResponse(
      500,
      'PROXY_CONFIGURATION_INVALID',
      'API proxy is not configured correctly',
    )
  }

  const requestUrl = new URL(request.url, DEFAULT_API_INTERNAL_URL)
  const upstreamUrl = new URL(upstreamPath(requestUrl), origin)

  try {
    return await fetch(new Request(upstreamUrl, request))
  } catch {
    return errorResponse(502, 'UPSTREAM_UNAVAILABLE', 'API service is unavailable')
  }
}

export {
  proxyRequest as DELETE,
  proxyRequest as GET,
  proxyRequest as PATCH,
  proxyRequest as POST,
  proxyRequest as PUT,
}
