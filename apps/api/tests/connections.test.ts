import { describe, expect, it, vi } from 'vitest'

import {
  createConnectionService,
  createFigmaConnectionDriver,
  createInMemoryConnectionRepository,
  createInMemoryCredentialStore,
  type ConnectionCatalog,
  type ConnectionDriver,
} from '@slopify/execution-runtime'
import { FIGMA_DESKTOP_MCP_URL } from '@slopify/agent-runtimes'

import { createApiApp } from '../src/app.js'
import { createChatGptOAuthService } from '@slopify/agent-runtimes'

const driver: ConnectionDriver = {
  type: 'gitlab',
  category: 'connector',
  credential: 'required',
  authority: 'Read and write GitLab resources available to the connected user.',
  async validate(input) {
    if (input.credential.type !== 'api_key' || input.credential.key !== 'secret')
      throw new Error('invalid')
    return { identity: { username: 'operator' }, scopes: ['api'] }
  },
}

const figmaDriver: ConnectionDriver = {
  type: 'figma',
  category: 'connector',
  credential: 'none',
  authority: 'Read designs available through the active Figma Desktop session.',
  async validate(input) {
    if (!(
      typeof input.configuration === 'object' &&
      input.configuration !== null &&
      'serverUrl' in input.configuration &&
      input.configuration.serverUrl === FIGMA_DESKTOP_MCP_URL
    ))
      throw new Error('invalid')
    return { serverUrl: FIGMA_DESKTOP_MCP_URL, tools: [{ name: 'get_metadata' }] }
  },
}

const catalog: ConnectionCatalog = {
  list: () => [
    {
      type: 'gitlab',
      category: 'connector',
      name: 'GitLab',
      icon: 'gitlab',
      eyebrow: 'Source control',
      summary: 'Read repositories and manage delivery through GitLab.',
      description: 'Connect GitLab to manage delivery.',
      setup: ['Create a personal access token.'],
      access: 'Uses the permissions available to your GitLab user.',
      credentialLabel: 'Personal access token',
      credentialDescription: 'Validated before storage.',
      replacementLabel: 'New personal access token',
      resourceHref: 'https://gitlab.com/-/user_settings/personal_access_tokens',
      resourceLabel: 'Create a personal access token',
    },
    {
      type: 'figma',
      category: 'connector',
      name: 'Figma',
      icon: 'figma',
      eyebrow: 'Design collaboration',
      summary: 'Inspect Figma designs.',
      description: 'Connect Figma.',
      setup: ['Sign in.'],
      access: 'Uses Figma MCP.',
      resourceHref: 'https://developers.figma.com/docs/figma-mcp-server/',
      resourceLabel: 'Learn about Figma MCP',
      skillId: 'figma-connector',
    },
    {
      type: 'chatgpt-subscription',
      category: 'inference',
      name: 'ChatGPT',
      icon: 'chatgpt',
      eyebrow: 'Subscription provider',
      summary: 'Use a ChatGPT subscription.',
      description: 'Connect ChatGPT.',
      setup: ['Sign in.'],
      access: 'Uses owner-local OAuth.',
      resourceHref: 'https://chatgpt.com/',
      resourceLabel: 'Open ChatGPT',
    },
  ],
}

const fixture = () => {
  const credentials = createInMemoryCredentialStore()
  const connections = createConnectionService({
    connections: createInMemoryConnectionRepository(),
    credentials,
    catalog,
    drivers: [driver, figmaDriver],
    now: () => '2026-08-20T00:00:00.000Z',
  })
  return {
    credentials,
    connections,
    app: createApiApp({ connections, connectionCatalog: catalog }),
  }
}

describe('connections API', () => {
  it('returns the database-backed catalog with current connection state', async () => {
    const { app } = fixture()

    const response = await app.request('/api/connections')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ catalog: catalog.list(), connections: [] })
  })

  it('connects only after validation and never returns the submitted credential', async () => {
    const { app, credentials } = fixture()
    const response = await app.request('/api/connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'gitlab',
        configuration: { baseUrl: 'https://gitlab.com' },
        credential: { type: 'api_key', key: 'secret' },
      }),
    })
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body).not.toHaveProperty('credential')
    expect(JSON.stringify(body)).not.toContain('secret')
    expect(body).toMatchObject({ connectionId: 'gitlab-default', label: 'GitLab' })
    expect(await credentials.read('gitlab-default')).toMatchObject({ key: 'secret' })
    const readback = await (await app.request('/api/connections')).text()
    expect(readback).not.toContain('secret')
  })

  it('lists, revalidates, replaces credentials, and disconnects', async () => {
    const { app } = fixture()
    const input = {
      type: 'gitlab',
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
      (await app.request('/api/connections/gitlab-default/revalidate', { method: 'POST' })).status,
    ).toBe(200)
    expect(
      (
        await app.request('/api/connections/gitlab-default/credential', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ credential: { type: 'api_key', key: 'secret' } }),
        })
      ).status,
    ).toBe(200)
    expect(
      (await app.request('/api/connections/gitlab-default', { method: 'DELETE' })).status,
    ).toBe(204)
  })

  it('returns a stable validation failure without echoing a secret', async () => {
    const { app } = fixture()
    const response = await app.request('/api/connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'gitlab',
        configuration: {},
        credential: { type: 'api_key', key: 'bad-secret' },
      }),
    })
    const body = await response.text()
    expect(response.status).toBe(422)
    expect(body).toContain('CONNECTION_VALIDATION_FAILED')
    expect(body).not.toContain('bad-secret')
  })

  it('rejects browser-selected connection identity fields and supports re-add after delete', async () => {
    const { app } = fixture()
    const rejected = await app.request('/api/connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connectionId: 'chosen-id',
        label: 'Chosen label',
        type: 'gitlab',
        configuration: {},
        credential: { type: 'api_key', key: 'secret' },
      }),
    })
    expect(rejected.status).toBe(400)

    const input = {
      type: 'gitlab',
      configuration: {},
      credential: { type: 'api_key', key: 'secret' },
    }
    const add = () =>
      app.request('/api/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
    expect((await add()).status).toBe(201)
    expect((await add()).status).toBe(409)
    expect(
      (await app.request('/api/connections/gitlab-default', { method: 'DELETE' })).status,
    ).toBe(204)
    expect((await add()).status).toBe(201)
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
    const app = createApiApp({ connections, connectionCatalog: catalog, chatGptOAuth: oauth })

    const start = await app.request('/api/connections/chatgpt/oauth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
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

  it('connects Figma Desktop through the fixed server-owned endpoint without credentials', async () => {
    const { app, credentials } = fixture()

    const response = await app.request('/api/connections/figma/desktop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      connectionId: 'figma-default',
      type: 'figma',
      configuration: { serverUrl: FIGMA_DESKTOP_MCP_URL },
    })
    expect(await credentials.read('figma-default')).toBeUndefined()
  })

  it('returns actionable recovery when Figma Desktop MCP is not running', async () => {
    const connections = createConnectionService({
      connections: createInMemoryConnectionRepository(),
      credentials: createInMemoryCredentialStore(),
      catalog,
      drivers: [
        createFigmaConnectionDriver({
          inspect: vi.fn(async () => {
            throw new Error('connect ECONNREFUSED 127.0.0.1:3845')
          }),
        }),
      ],
    })
    const app = createApiApp({ connections, connectionCatalog: catalog })

    const response = await app.request('/api/connections/figma/desktop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: {
        code: 'CONNECTION_VALIDATION_FAILED',
        message:
          'Figma Desktop MCP is unavailable. Open a design in Dev Mode and enable the desktop MCP server, then try again.',
      },
    })
  })
})
