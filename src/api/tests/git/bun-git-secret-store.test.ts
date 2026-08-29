import { describe, expect, it, vi } from 'vitest'

import { createBunGitSecretStore } from '../../src/index.js'

describe('Bun Git secret store', () => {
  it('uses stable provider keys in the OS credential store', async () => {
    const secrets = {
      get: vi.fn(async () => 'stored-token'),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
    }
    const store = createBunGitSecretStore({ secrets })

    await expect(store.get('GITHUB')).resolves.toBe('stored-token')
    await store.set('GITLAB', 'gitlab-token')
    await expect(store.delete('GITHUB')).resolves.toBe(true)

    expect(secrets.get).toHaveBeenCalledWith({ service: 'dev.slopify.git', name: 'github.com' })
    expect(secrets.set).toHaveBeenCalledWith({
      service: 'dev.slopify.git',
      name: 'gitlab.com',
      value: 'gitlab-token',
    })
    expect(secrets.delete).toHaveBeenCalledWith({ service: 'dev.slopify.git', name: 'github.com' })
  })
})
