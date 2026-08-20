import { describe, expect, it, vi } from 'vitest'

import {
  ConnectionServiceError,
  createConnectionService,
  createInMemoryConnectionRepository,
  createInMemoryCredentialStore,
  type ConnectionDriver,
} from '../../src/index.js'

const gitlabDriver: ConnectionDriver = {
  type: 'gitlab',
  category: 'connector',
  authority: 'Read and write GitLab resources available to the connected user.',
  async validate(input) {
    if (input.credential.type !== 'api_key' || input.credential.key !== 'valid-token')
      throw new ConnectionServiceError('CONNECTION_VALIDATION_FAILED')
    return { identity: { username: 'operator' }, scopes: ['api'] }
  },
}

describe('connection service', () => {
  it('validates before persisting and returns metadata without credentials', async () => {
    const credentials = createInMemoryCredentialStore()
    const connections = createInMemoryConnectionRepository()
    const service = createConnectionService({
      connections,
      credentials,
      drivers: [gitlabDriver],
      ids: () => 'gitlab-primary',
      now: () => '2026-08-20T00:00:00.000Z',
    })

    const connected = await service.connect({
      type: 'gitlab',
      label: 'Primary GitLab',
      configuration: { baseUrl: 'https://gitlab.com' },
      credential: { type: 'api_key', key: 'valid-token' },
    })

    expect(connected).not.toHaveProperty('credential')
    expect(connected).toMatchObject({
      connectionId: 'gitlab-primary',
      type: 'gitlab',
      category: 'connector',
      status: 'CONNECTED',
    })
    expect(await credentials.read('gitlab-primary')).toEqual({
      type: 'api_key',
      key: 'valid-token',
    })
  })

  it('persists nothing when remote validation fails', async () => {
    const credentials = createInMemoryCredentialStore()
    const connections = createInMemoryConnectionRepository()
    const service = createConnectionService({
      connections,
      credentials,
      drivers: [gitlabDriver],
      ids: () => 'gitlab-primary',
    })

    await expect(
      service.connect({
        type: 'gitlab',
        label: 'Primary GitLab',
        configuration: { baseUrl: 'https://gitlab.com' },
        credential: { type: 'api_key', key: 'invalid' },
      }),
    ).rejects.toMatchObject({ code: 'CONNECTION_VALIDATION_FAILED' })
    expect(connections.list()).toEqual([])
    expect(await credentials.read('gitlab-primary')).toBeUndefined()
  })

  it('revalidates, replaces, and disconnects through registered drivers', async () => {
    const validate = vi.fn(gitlabDriver.validate)
    const credentials = createInMemoryCredentialStore()
    const connections = createInMemoryConnectionRepository()
    const service = createConnectionService({
      connections,
      credentials,
      drivers: [{ ...gitlabDriver, validate }],
      ids: () => 'gitlab-primary',
    })
    await service.connect({
      type: 'gitlab',
      label: 'GitLab',
      configuration: { baseUrl: 'https://gitlab.com' },
      credential: { type: 'api_key', key: 'valid-token' },
    })
    await service.revalidate('gitlab-primary')
    await service.replaceCredential('gitlab-primary', { type: 'api_key', key: 'valid-token' })
    await service.disconnect('gitlab-primary')

    expect(validate).toHaveBeenCalledTimes(3)
    expect(connections.list()).toEqual([])
    expect(await credentials.read('gitlab-primary')).toBeUndefined()
  })
})
