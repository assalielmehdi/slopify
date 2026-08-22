import { describe, expect, it, vi } from 'vitest'

import { createChatGptOAuthService } from '../src/index.js'

const { createModelRuntime } = vi.hoisted(() => ({ createModelRuntime: vi.fn() }))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: { create: createModelRuntime },
}))

describe('ChatGPT subscription OAuth', () => {
  it('selects browser login and leaves manual code entry pending for the local callback', async () => {
    const promptTypes: string[] = []
    const login = vi.fn(async (_providerId, _type, interaction) => {
      promptTypes.push('select')
      expect(
        await interaction.prompt({
          type: 'select',
          message: 'Select OpenAI Codex login method:',
          options: [
            { id: 'browser', label: 'Browser login (default)' },
            { id: 'device_code', label: 'Device code login (headless)' },
          ],
        }),
      ).toBe('browser')

      const manualCode = interaction.prompt({
        type: 'manual_code',
        message: 'Paste the authorization code here',
      })
      void manualCode.then(() => promptTypes.push('manual-settled'))
      interaction.notify({
        type: 'auth_url',
        url: 'https://auth.openai.com/authorize?opaque=yes',
      })
      await Promise.resolve()
      expect(promptTypes).toEqual(['select'])

      return {
        type: 'oauth' as const,
        access: 'access-that-must-not-be-returned',
        refresh: 'refresh-that-must-not-be-returned',
        expires: Date.now() + 60_000,
      }
    })
    createModelRuntime.mockResolvedValue({ login })
    const service = createChatGptOAuthService({
      connect: async () => 'connection-01',
      createTransactionId: () => 'oauth-browser',
    })

    service.start({ label: 'My ChatGPT' })

    await vi.waitFor(() => expect(service.get('oauth-browser')?.status).toBe('CONNECTED'))
    expect(login).toHaveBeenCalledWith(
      'openai-codex',
      'oauth',
      expect.objectContaining({ prompt: expect.any(Function), notify: expect.any(Function) }),
    )
  })

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

  it('reports a sanitized authorization phase when Pi login fails', async () => {
    const service = createChatGptOAuthService({
      connect: async () => 'connection-01',
      createTransactionId: () => 'oauth-login-failed',
      login: async () => {
        throw new Error('secret token exchange response')
      },
    })

    service.start({ label: 'My ChatGPT' })

    await vi.waitFor(() => expect(service.get('oauth-login-failed')?.status).toBe('FAILED'))
    expect(service.get('oauth-login-failed')).toEqual({
      id: 'oauth-login-failed',
      status: 'FAILED',
      message: 'ChatGPT authorization failed',
    })
    expect(JSON.stringify(service.get('oauth-login-failed'))).not.toContain('secret')
  })

  it('reports a sanitized persistence phase when storing the credential fails', async () => {
    const service = createChatGptOAuthService({
      connect: async () => {
        throw new Error('secret credential persistence detail')
      },
      createTransactionId: () => 'oauth-storage-failed',
      login: async () => ({
        type: 'oauth',
        access: 'access-secret',
        refresh: 'refresh-secret',
        expires: Date.now() + 60_000,
      }),
    })

    service.start({ label: 'My ChatGPT' })

    await vi.waitFor(() => expect(service.get('oauth-storage-failed')?.status).toBe('FAILED'))
    expect(service.get('oauth-storage-failed')).toEqual({
      id: 'oauth-storage-failed',
      status: 'FAILED',
      message: 'ChatGPT credential could not be stored',
    })
    expect(JSON.stringify(service.get('oauth-storage-failed'))).not.toContain('secret')
  })
})
