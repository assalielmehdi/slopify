import { describe, expect, it, vi } from 'vitest'

import { createChatGptOAuthService } from '../src/index.js'

describe('ChatGPT subscription OAuth', () => {
  it('exposes only a temporary authorization URL before persisting the completed credential', async () => {
    let complete:
      | ((credential: { type: 'oauth'; access: string; refresh: string; expires: number }) => void)
      | undefined
    const connect = vi.fn(async () => 'connection-01')
    const service = createChatGptOAuthService({
      connect,
      createTransactionId: () => 'oauth-01',
      login: ({ notify }) =>
        new Promise((resolve) => {
          complete = resolve
          notify({
            type: 'auth_url',
            url: 'https://auth.openai.com/authorize?opaque=yes',
            instructions: 'Continue in your browser',
          })
        }),
    })

    expect(service.start({ label: 'My ChatGPT' })).toEqual({ id: 'oauth-01', status: 'PENDING' })
    expect(service.get('oauth-01')).toEqual({
      id: 'oauth-01',
      status: 'PENDING',
      authorizationUrl: 'https://auth.openai.com/authorize?opaque=yes',
      instructions: 'Continue in your browser',
    })
    complete?.({
      type: 'oauth',
      access: 'access-that-must-not-be-returned',
      refresh: 'refresh-that-must-not-be-returned',
      expires: Date.now() + 60_000,
    })
    await vi.waitFor(() => expect(service.get('oauth-01')?.status).toBe('CONNECTED'))

    expect(service.get('oauth-01')).toEqual({
      id: 'oauth-01',
      status: 'CONNECTED',
      connectionId: 'connection-01',
    })
    expect(JSON.stringify(service.get('oauth-01'))).not.toContain(
      'access-that-must-not-be-returned',
    )
  })

  it('cancels an in-flight transaction without exposing an OAuth error', () => {
    const service = createChatGptOAuthService({
      connect: async () => 'connection-01',
      createTransactionId: () => 'oauth-01',
      login: () => new Promise(() => undefined),
    })
    service.start({ label: 'My ChatGPT' })

    expect(service.cancel('oauth-01')).toBe(true)
    expect(service.get('oauth-01')).toEqual({ id: 'oauth-01', status: 'CANCELLED' })
  })
})
