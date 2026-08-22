import { describe, expect, it, vi } from 'vitest'

import {
  ConnectionServiceError,
  createConnectionService,
  createInMemoryConnectionRepository,
  createInMemoryCredentialStore,
  type ConnectionDriver,
  type ConnectionCatalog,
} from '../../src/index.js'

const catalog: ConnectionCatalog = {
  list: () => [
    {
      type: 'gitlab',
      category: 'connector',
      name: 'GitLab',
      icon: 'gitlab',
      eyebrow: 'Source control',
      summary: 'Manage GitLab resources.',
      description: 'Connect GitLab.',
      setup: [],
      access: 'Uses the connected user permissions.',
      credentialLabel: 'Token',
      credentialDescription: 'Validated before storage.',
      replacementLabel: 'New token',
      resourceHref: 'https://gitlab.com',
      resourceLabel: 'Open GitLab',
      models: [],
    },
  ],
}

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
      catalog,
      drivers: [gitlabDriver],
      now: () => '2026-08-20T00:00:00.000Z',
    })

    const connected = await service.connect({
      type: 'gitlab',
      configuration: { baseUrl: 'https://gitlab.com' },
      credential: { type: 'api_key', key: 'valid-token' },
    })

    expect(connected).not.toHaveProperty('credential')
    expect(connected).toMatchObject({
      connectionId: 'gitlab-default',
      type: 'gitlab',
      category: 'connector',
      label: 'GitLab',
      status: 'CONNECTED',
    })
    expect(await credentials.read('gitlab-default')).toEqual({
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
      catalog,
      drivers: [gitlabDriver],
    })

    await expect(
      service.connect({
        type: 'gitlab',
        configuration: { baseUrl: 'https://gitlab.com' },
        credential: { type: 'api_key', key: 'invalid' },
      }),
    ).rejects.toMatchObject({ code: 'CONNECTION_VALIDATION_FAILED' })
    expect(connections.list()).toEqual([])
    expect(await credentials.read('gitlab-default')).toBeUndefined()
  })

  it('revalidates, replaces, and disconnects through registered drivers', async () => {
    const validate = vi.fn(gitlabDriver.validate)
    const credentials = createInMemoryCredentialStore()
    const connections = createInMemoryConnectionRepository()
    const service = createConnectionService({
      connections,
      credentials,
      catalog,
      drivers: [{ ...gitlabDriver, validate }],
    })
    await service.connect({
      type: 'gitlab',
      configuration: { baseUrl: 'https://gitlab.com' },
      credential: { type: 'api_key', key: 'valid-token' },
    })
    await service.revalidate('gitlab-default')
    await service.replaceCredential('gitlab-default', { type: 'api_key', key: 'valid-token' })
    await service.disconnect('gitlab-default')

    expect(validate).toHaveBeenCalledTimes(3)
    expect(connections.list()).toEqual([])
    expect(await credentials.read('gitlab-default')).toBeUndefined()
  })

  it('allows only one connection per catalog type and supports delete then re-add', async () => {
    const credentials = createInMemoryCredentialStore()
    const connections = createInMemoryConnectionRepository()
    const service = createConnectionService({
      connections,
      credentials,
      catalog,
      drivers: [gitlabDriver],
    })
    const input = {
      type: 'gitlab' as const,
      configuration: {},
      credential: { type: 'api_key' as const, key: 'valid-token' },
    }

    await service.connect(input)
    await expect(service.connect(input)).rejects.toMatchObject({
      code: 'CONNECTION_ALREADY_EXISTS',
    })
    await service.disconnect('gitlab-default')
    await expect(service.connect(input)).resolves.toMatchObject({ connectionId: 'gitlab-default' })
  })

  it('rejects a driver type that is absent from the persisted catalog', async () => {
    const service = createConnectionService({
      connections: createInMemoryConnectionRepository(),
      credentials: createInMemoryCredentialStore(),
      catalog: { list: () => [] },
      drivers: [gitlabDriver],
    })

    await expect(
      service.connect({
        type: 'gitlab',
        configuration: {},
        credential: { type: 'api_key', key: 'valid-token' },
      }),
    ).rejects.toMatchObject({ code: 'CONNECTION_TYPE_UNSUPPORTED' })
  })
})
