const ENABLE_ENVIRONMENT_VARIABLE = 'SLOPIFY_E2E_CONNECTION_VALIDATION'

export const E2E_CONNECTION_CREDENTIAL = 'slopify-e2e-valid'

type Fetch = typeof globalThis.fetch

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

const validationResponses = new Map<
  string,
  Readonly<{ header: string; value: string; body: unknown }>
>([
  [
    'https://gitlab.com/api/v4/personal_access_tokens/self',
    {
      header: 'private-token',
      value: E2E_CONNECTION_CREDENTIAL,
      body: {
        id: 7,
        name: 'Slopify E2E',
        active: true,
        revoked: false,
        expires_at: null,
        scopes: ['api'],
      },
    },
  ],
  [
    'https://gitlab.com/api/v4/user',
    {
      header: 'private-token',
      value: E2E_CONNECTION_CREDENTIAL,
      body: { id: 42, username: 'slopify-e2e', name: 'Slopify E2E' },
    },
  ],
  [
    'https://api.clickup.com/api/v2/user',
    {
      header: 'authorization',
      value: E2E_CONNECTION_CREDENTIAL,
      body: { user: { id: 3, username: 'Slopify E2E', email: 'e2e@example.invalid' } },
    },
  ],
  [
    'https://api.clickup.com/api/v2/team',
    {
      header: 'authorization',
      value: E2E_CONNECTION_CREDENTIAL,
      body: { teams: [{ id: '12', name: 'E2E Workspace' }] },
    },
  ],
  [
    'https://openrouter.ai/api/v1/key',
    {
      header: 'authorization',
      value: `Bearer ${E2E_CONNECTION_CREDENTIAL}`,
      body: {
        data: {
          label: 'Slopify E2E',
          limit: 100,
          limit_remaining: 100,
          is_free_tier: false,
        },
      },
    },
  ],
])

export const createFakeConnectionValidationFetch = (upstream: Fetch): Fetch =>
  async function fakeConnectionValidationFetch(input, init) {
    const request = new Request(input, init)
    const validation = validationResponses.get(request.url)
    if (validation === undefined) return upstream(input, init)

    return request.headers.get(validation.header) === validation.value
      ? json(validation.body)
      : json({ error: 'Unauthorized' }, 401)
  }

if (process.env[ENABLE_ENVIRONMENT_VARIABLE] !== '1') {
  throw new Error(`${ENABLE_ENVIRONMENT_VARIABLE}=1 is required for the E2E validation preload`)
}

globalThis.fetch = createFakeConnectionValidationFetch(globalThis.fetch.bind(globalThis))
