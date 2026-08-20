import { describe, expect, it, vi } from 'vitest'

import {
  createConnectionService,
  createInMemoryConnectionRepository,
  createInMemoryCredentialStore,
  type ConnectionDriver,
} from '@loop/execution-runtime'

import { createApiApp } from '../src/app.js'
import { createChatGptOAuthService } from '@loop/agent-runtimes'

const driver: ConnectionDriver = {
  type: 'gitlab',
  category: 'connector',
  authority: 'Read and write GitLab resources available to the connected user.',
  async validate(input) {
    if (input.credential.type !== 'api_key' || input.credential.key !== 'secret')
      throw new Error('invalid')
    return { identity: { username: 'operator' }, scopes: ['api'] }
  },
}

const fixture = () => {
  const credentials = createInMemoryCredentialStore()
  const connections = createConnectionService({
    connections: createInMemoryConnectionRepository(),
    credentials,
    drivers: [driver],
    ids: () => 'gitlab-primary',
    now: () => '2026-08-20T00:00:00.000Z',
  })
  return { credentials, connections, app: createApiApp({ connections }) }
}

describe('connections API', () => {
  it('connects only after validation and never returns the submitted credential', async () => {
    const { app, credentials } = fixture()
    const response = await app.request('/api/connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'gitlab',
        label: 'Primary GitLab',
        configuration: { baseUrl: 'https://gitlab.com' },
        credential: { type: 'api_key', key: 'secret' },
      }),
    })
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body).not.toHaveProperty('credential')
    expect(JSON.stringify(body)).not.toContain('secret')
    expect(await credentials.read('gitlab-primary')).toMatchObject({ key: 'secret' })
  })

  it('lists, revalidates, replaces credentials, and disconnects', async () => {
    const { app } = fixture()
    const input = {
      type: 'gitlab',
      label: 'GitLab',
      configuration: {},
      credential: { type: 'api_key', key: 'secret' },
    }
    await app.request('/api/connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    expect((await app.request('/api/connections')).status).toBe(200)
    expect(
      (await app.request('/api/connections/gitlab-primary/revalidate', { method: 'POST' })).status,
    ).toBe(200)
    expect(
      (
        await app.request('/api/connections/gitlab-primary/credential', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ credential: { type: 'api_key', key: 'secret' } }),
        })
      ).status,
    ).toBe(200)
    expect(
      (await app.request('/api/connections/gitlab-primary', { method: 'DELETE' })).status,
    ).toBe(204)
  })

  it('returns a stable validation failure without echoing a secret', async () => {
    const { app } = fixture()
    const response = await app.request('/api/connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'gitlab',
        label: 'GitLab',
        configuration: {},
        credential: { type: 'api_key', key: 'bad-secret' },
      }),
    })
    const body = await response.text()
    expect(response.status).toBe(422)
    expect(body).toContain('CONNECTION_VALIDATION_FAILED')
    expect(body).not.toContain('bad-secret')
  })

  it('starts and polls ChatGPT subscription OAuth without returning tokens', async () => {
    const { connections } = fixture()
    let complete:
      | ((credential: { type: 'oauth'; access: string; refresh: string; expires: number }) => void)
      | undefined
    const oauth = createChatGptOAuthService({
      createTransactionId: () => 'oauth-01',
      login: ({ notify }) =>
        new Promise((resolve) => {
          complete = resolve
          notify({ type: 'auth_url', url: 'https://auth.openai.com/authorize' })
        }),
      connect: async () => 'chatgpt-primary',
    })
    const app = createApiApp({ connections, chatGptOAuth: oauth })

    const start = await app.request('/api/connections/chatgpt/oauth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'My ChatGPT' }),
    })
    expect(start.status).toBe(202)
    expect(await start.json()).toEqual({ id: 'oauth-01', status: 'PENDING' })
    const pending = await (await app.request('/api/connections/chatgpt/oauth/oauth-01')).json()
    expect(pending).toMatchObject({
      status: 'PENDING',
      authorizationUrl: 'https://auth.openai.com/authorize',
    })

    complete?.({
      type: 'oauth',
      access: 'access-secret',
      refresh: 'refresh-secret',
      expires: Date.now() + 60_000,
    })
    await vi.waitFor(async () => {
      const response = await app.request('/api/connections/chatgpt/oauth/oauth-01')
      expect(await response.json()).toMatchObject({ status: 'CONNECTED' })
    })
    expect(
      JSON.stringify(await (await app.request('/api/connections/chatgpt/oauth/oauth-01')).json()),
    ).not.toContain('secret')
  })
})
