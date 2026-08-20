import { z } from 'zod'

import type { ConnectionDriver, ConnectionValidationInput } from './connection-service.js'

type Fetch = typeof globalThis.fetch

const ApiKeyCredentialSchema = z.strictObject({
  type: z.literal('api_key'),
  key: z.string().min(1),
})
const BaseUrlConfigurationSchema = z.strictObject({ baseUrl: z.url().optional() }).default({})

const requestJson = async (
  fetch: Fetch,
  url: string,
  headers: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<unknown> => {
  const timeout = AbortSignal.timeout(10_000)
  const response = await fetch(url, {
    headers,
    signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
  })
  if (!response.ok) throw new Error('Connection validation request failed')
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json'))
    throw new Error('Connection validation response is not JSON')
  return response.json()
}

const credential = (input: ConnectionValidationInput): string =>
  ApiKeyCredentialSchema.parse(input.credential).key

const normalizeOrigin = (url: string): string => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '')
    throw new Error('Connection base URL must be an HTTPS origin')
  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.origin
}

const GitLabTokenSchema = z.object({
  active: z.boolean(),
  revoked: z.boolean(),
  expires_at: z.string().nullable(),
  scopes: z.array(z.string()),
})
const GitLabUserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  name: z.string(),
})

export const createGitLabConnectionDriver = (
  options: Readonly<{ fetch?: Fetch }> = {},
): ConnectionDriver => ({
  type: 'gitlab',
  category: 'connector',
  authority: 'Read and write GitLab resources available to the connected user.',
  async validate(input) {
    const token = credential(input)
    const configuration = BaseUrlConfigurationSchema.parse(input.configuration)
    const baseUrl = normalizeOrigin(configuration.baseUrl ?? 'https://gitlab.com')
    const headers = { 'PRIVATE-TOKEN': token }
    const tokenMetadata = GitLabTokenSchema.parse(
      await requestJson(
        options.fetch ?? globalThis.fetch,
        `${baseUrl}/api/v4/personal_access_tokens/self`,
        headers,
        input.signal,
      ),
    )
    const expired =
      tokenMetadata.expires_at !== null &&
      Date.parse(`${tokenMetadata.expires_at}T23:59:59.999Z`) < Date.now()
    if (
      !tokenMetadata.active ||
      tokenMetadata.revoked ||
      expired ||
      !tokenMetadata.scopes.includes('api')
    )
      throw new Error('GitLab token is inactive, expired, revoked, or missing api scope')
    const identity = GitLabUserSchema.parse(
      await requestJson(
        options.fetch ?? globalThis.fetch,
        `${baseUrl}/api/v4/user`,
        headers,
        input.signal,
      ),
    )
    return {
      identity,
      scopes: tokenMetadata.scopes,
      expiresAt: tokenMetadata.expires_at,
    }
  },
})

const ClickUpUserSchema = z.strictObject({
  user: z.object({ id: z.number().int(), username: z.string(), email: z.string() }),
})
const ClickUpTeamsSchema = z.strictObject({
  teams: z.array(z.object({ id: z.string(), name: z.string() })),
})

export const createClickUpConnectionDriver = (
  options: Readonly<{ fetch?: Fetch }> = {},
): ConnectionDriver => ({
  type: 'clickup',
  category: 'connector',
  authority: 'Read and write ClickUp resources available to the connected user.',
  async validate(input) {
    const token = credential(input)
    const configuration = BaseUrlConfigurationSchema.parse(input.configuration)
    const baseUrl = normalizeOrigin(configuration.baseUrl ?? 'https://api.clickup.com')
    const headers = { Authorization: token }
    const fetch = options.fetch ?? globalThis.fetch
    const identity = ClickUpUserSchema.parse(
      await requestJson(fetch, `${baseUrl}/api/v2/user`, headers, input.signal),
    ).user
    const workspaces = ClickUpTeamsSchema.parse(
      await requestJson(fetch, `${baseUrl}/api/v2/team`, headers, input.signal),
    ).teams.map(({ id, name }) => ({ id, name }))
    return { identity, workspaces }
  },
})

const OpenRouterKeySchema = z.strictObject({
  data: z.object({
    label: z.string(),
    limit: z.number().nullable(),
    limit_remaining: z.number().nullable(),
    is_free_tier: z.boolean(),
  }),
})

export const createOpenRouterConnectionDriver = (
  options: Readonly<{ fetch?: Fetch }> = {},
): ConnectionDriver => ({
  type: 'openrouter',
  category: 'inference',
  authority: 'Use the connected OpenRouter account for model inference.',
  async validate(input) {
    const key = credential(input)
    const metadata = OpenRouterKeySchema.parse(
      await requestJson(
        options.fetch ?? globalThis.fetch,
        'https://openrouter.ai/api/v1/key',
        { Authorization: `Bearer ${key}` },
        input.signal,
      ),
    ).data
    return {
      label: metadata.label,
      limit: metadata.limit,
      limitRemaining: metadata.limit_remaining,
      freeTier: metadata.is_free_tier,
    }
  },
})

export const createChatGptSubscriptionConnectionDriver = (
  options: Readonly<{ now?: () => number }> = {},
): ConnectionDriver => ({
  type: 'chatgpt-subscription',
  category: 'inference',
  authority: "Use the connected ChatGPT subscription through Pi's OpenAI Codex provider.",
  async validate(input) {
    const value = z
      .strictObject({
        type: z.literal('oauth'),
        access: z.string().min(1),
        refresh: z.string().min(1),
        expires: z.number().int().positive().safe(),
      })
      .parse(input.credential)
    if (value.expires <= (options.now ?? Date.now)())
      throw new Error('ChatGPT OAuth credential is expired')
    return { provider: 'openai-codex', subscription: true, expiresAt: value.expires }
  },
})
