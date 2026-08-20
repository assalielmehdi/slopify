const DEFAULT_API_INTERNAL_URL = 'http://127.0.0.1:3001'

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json({ error: { code, message } }, { status })

const apiOrigin = (): string => {
  const url = new URL(process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL)
  const isHttp = url.protocol === 'http:' || url.protocol === 'https:'
  const isOriginOnly =
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''

  if (!isHttp || !isOriginOnly) throw new Error('Invalid API origin')
  return url.origin
}

const upstreamPath = (requestUrl: URL): string =>
  requestUrl.pathname === '/api/healthz'
    ? `/healthz${requestUrl.search}`
    : `${requestUrl.pathname}${requestUrl.search}`

const proxyRequest = async (request: Request): Promise<Response> => {
  let origin: string
  try {
    origin = apiOrigin()
  } catch {
    return errorResponse(
      500,
      'PROXY_CONFIGURATION_INVALID',
      'API proxy is not configured correctly',
    )
  }

  const requestUrl = new URL(request.url)
  const upstreamUrl = new URL(upstreamPath(requestUrl), origin)

  try {
    return await fetch(new Request(upstreamUrl, request))
  } catch {
    return errorResponse(502, 'UPSTREAM_UNAVAILABLE', 'API service is unavailable')
  }
}

export { proxyRequest as DELETE, proxyRequest as GET, proxyRequest as POST, proxyRequest as PUT }
