import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const originalFetch = globalThis.fetch
const originalEnablement = process.env.SLOPIFY_E2E_CONNECTION_VALIDATION
const upstream = vi.fn<typeof globalThis.fetch>(async () => new Response('delegated'))

let credential = ''

beforeAll(async () => {
  process.env.SLOPIFY_E2E_CONNECTION_VALIDATION = '1'
  globalThis.fetch = upstream
  vi.resetModules()
  const fixture = await import('./fixtures/fake-connection-validation.js')
  credential = fixture.E2E_CONNECTION_CREDENTIAL
})

afterAll(() => {
  globalThis.fetch = originalFetch
  if (originalEnablement === undefined) delete process.env.SLOPIFY_E2E_CONNECTION_VALIDATION
  else process.env.SLOPIFY_E2E_CONNECTION_VALIDATION = originalEnablement
})

describe('fake connection validation preload', () => {
  it.each([
    {
      url: 'https://gitlab.com/api/v4/personal_access_tokens/self',
      headers: { 'PRIVATE-TOKEN': () => credential },
      expected: { active: true, revoked: false, expires_at: null, scopes: ['api'] },
    },
    {
      url: 'https://gitlab.com/api/v4/user',
      headers: { 'PRIVATE-TOKEN': () => credential },
      expected: { id: 42, username: 'slopify-e2e', name: 'Slopify E2E' },
    },
    {
      url: 'https://api.clickup.com/api/v2/user',
      headers: { Authorization: () => credential },
      expected: {
        user: { id: 3, username: 'Slopify E2E', email: 'e2e@example.invalid' },
      },
    },
    {
      url: 'https://api.clickup.com/api/v2/team',
      headers: { Authorization: () => credential },
      expected: { teams: [{ id: '12', name: 'E2E Workspace' }] },
    },
    {
      url: 'https://openrouter.ai/api/v1/key',
      headers: { Authorization: () => `Bearer ${credential}` },
      expected: {
        data: {
          label: 'Slopify E2E',
          limit: 100,
          limit_remaining: 100,
          is_free_tier: false,
        },
      },
    },
  ])('returns realistic validation data for $url', async ({ url, headers, expected }) => {
    const response = await fetch(url, {
      headers: Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, value()])),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject(expected)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('rejects missing or incorrect credentials without returning them', async () => {
    const response = await fetch('https://gitlab.com/api/v4/user', {
      headers: { 'PRIVATE-TOKEN': 'not-the-e2e-credential' },
    })
    const body = await response.text()

    expect(response.status).toBe(401)
    expect(body).not.toContain('not-the-e2e-credential')
    expect(body).not.toContain(credential)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('delegates every URL outside the exact validation allowlist', async () => {
    const url = 'https://gitlab.com/api/v4/user?unexpected=true'

    const response = await fetch(url)

    expect(await response.text()).toBe('delegated')
    expect(upstream).toHaveBeenCalledWith(url, undefined)
  })
})
