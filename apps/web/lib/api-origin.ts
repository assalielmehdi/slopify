export const DEFAULT_API_INTERNAL_URL = 'http://127.0.0.1:3001'

export function internalApiOrigin(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configuredUrl = environment.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL
  if (!URL.canParse(configuredUrl)) throw new Error('Invalid API origin')

  const url = new URL(configuredUrl)
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
