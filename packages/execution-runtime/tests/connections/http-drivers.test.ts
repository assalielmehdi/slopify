import { describe, expect, it, vi } from 'vitest'

import {
  createClickUpConnectionDriver,
  createGitLabConnectionDriver,
  createOpenRouterConnectionDriver,
} from '../../src/index.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('HTTP connection drivers', () => {
  it('validates an active GitLab PAT with api scope and reads its identity', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json({
          id: 7,
          name: 'Slopify',
          active: true,
          revoked: false,
          expires_at: null,
          scopes: ['api'],
        }),
      )
      .mockResolvedValueOnce(json({ id: 42, username: 'operator', name: 'Operator' }))
    const driver = createGitLabConnectionDriver({ fetch })

    await expect(
      driver.validate({
        configuration: { baseUrl: 'https://gitlab.example.com' },
        credential: { type: 'api_key', key: 'glpat-secret' },
      }),
    ).resolves.toEqual({
      identity: { id: 42, username: 'operator', name: 'Operator' },
      scopes: ['api'],
      expiresAt: null,
    })
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://gitlab.example.com/api/v4/personal_access_tokens/self',
      expect.objectContaining({ headers: { 'PRIVATE-TOKEN': 'glpat-secret' } }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://gitlab.example.com/api/v4/user',
      expect.objectContaining({ headers: { 'PRIVATE-TOKEN': 'glpat-secret' } }),
    )
  })

  it.each([
    { active: false, revoked: false, expires_at: null, scopes: ['api'] },
    { active: true, revoked: true, expires_at: null, scopes: ['api'] },
    { active: true, revoked: false, expires_at: '2020-01-01', scopes: ['api'] },
    { active: true, revoked: false, expires_at: null, scopes: ['read_api'] },
  ])('rejects an unusable GitLab PAT %#', async (token) => {
    const driver = createGitLabConnectionDriver({ fetch: vi.fn().mockResolvedValue(json(token)) })
    await expect(
      driver.validate({
        configuration: {},
        credential: { type: 'api_key', key: 'secret' },
      }),
    ).rejects.toThrow()
  })

  it('validates ClickUp identity and accessible workspaces', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json({ user: { id: 3, username: 'Operator', email: 'op@example.com' } }),
      )
      .mockResolvedValueOnce(json({ teams: [{ id: '12', name: 'Delivery' }] }))
    const driver = createClickUpConnectionDriver({ fetch })

    await expect(
      driver.validate({ configuration: {}, credential: { type: 'api_key', key: 'pk_secret' } }),
    ).resolves.toEqual({
      identity: { id: 3, username: 'Operator', email: 'op@example.com' },
      workspaces: [{ id: '12', name: 'Delivery' }],
    })
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.clickup.com/api/v2/user',
      expect.objectContaining({ headers: { Authorization: 'pk_secret' } }),
    )
  })

  it('validates an OpenRouter key through the current-key endpoint', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({
        data: { label: 'Production', limit: 100, limit_remaining: 25, is_free_tier: false },
      }),
    )
    const driver = createOpenRouterConnectionDriver({ fetch })

    await expect(
      driver.validate({ configuration: {}, credential: { type: 'api_key', key: 'sk-or-secret' } }),
    ).resolves.toEqual({
      label: 'Production',
      limit: 100,
      limitRemaining: 25,
      freeTier: false,
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/key',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-or-secret' } }),
    )
  })

  it('rejects credentials and non-successful or non-JSON responses uniformly', async () => {
    const drivers = [
      createGitLabConnectionDriver({
        fetch: vi.fn().mockResolvedValue(new Response('', { status: 401 })),
      }),
      createClickUpConnectionDriver({ fetch: vi.fn().mockResolvedValue(new Response('nope')) }),
      createOpenRouterConnectionDriver({
        fetch: vi.fn().mockResolvedValue(new Response('', { status: 500 })),
      }),
    ]
    for (const driver of drivers) {
      await expect(
        driver.validate({ configuration: {}, credential: { type: 'api_key', key: 'secret' } }),
      ).rejects.toThrow()
    }
  })
})
