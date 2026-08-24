import type { GitConnection, GitProvider, GitRepository } from '@slopify/contracts'
import { describe, expect, it } from 'vitest'

import {
  GitConnectionServiceError,
  createGitConnectionService,
  type GitConnectionRecord,
  type GitConnectionRepository,
  type GitSecretStore,
  type RemoteGitHost,
} from '../../src/index.js'

const timestamp = '2026-08-24T00:00:00.000Z'

const createFixture = () => {
  const records = new Map<GitProvider, GitConnectionRecord>()
  const tokens = new Map<GitProvider, string>()
  const connections: GitConnectionRepository = {
    get: (provider) => records.get(provider),
    list: () => [...records.values()],
    save: (record) => records.set(record.provider, record),
    delete: (provider) => records.delete(provider),
  }
  const secrets: GitSecretStore = {
    get: async (provider) => tokens.get(provider) ?? null,
    set: async (provider, token) => void tokens.set(provider, token),
    delete: async (provider) => tokens.delete(provider),
  }
  const repository: GitRepository = {
    provider: 'GITHUB',
    remoteId: '123',
    name: 'slopify',
    fullName: 'operator/slopify',
    cloneUrl: 'https://github.com/operator/slopify.git',
    webUrl: 'https://github.com/operator/slopify',
    visibility: 'PRIVATE',
    defaultBranch: 'main',
  }
  const remote: RemoteGitHost = {
    authenticate: async (provider, token) => {
      if (token !== 'valid-token') throw new Error('unauthorized')
      return { provider, accountUsername: 'operator' }
    },
    listRepositories: async () => [repository],
    getRepository: async (_provider, _token, remoteId) =>
      remoteId === repository.remoteId ? repository : undefined,
    getDefaultBranchSha: async () => 'a'.repeat(40) as never,
  }
  return {
    records,
    tokens,
    service: createGitConnectionService({ connections, secrets, remote, now: () => timestamp }),
  }
}

describe('Git connection service', () => {
  it('validates a PAT before storing it and returns only non-secret account metadata', async () => {
    const fixture = createFixture()

    const connection = await fixture.service.configure('GITHUB', { token: 'valid-token' })

    expect(connection).toEqual<GitConnection>({
      provider: 'GITHUB',
      accountUsername: 'operator',
      connectedAt: timestamp,
      updatedAt: timestamp,
    })
    expect(fixture.tokens.get('GITHUB')).toBe('valid-token')
    expect(fixture.service.list()).toEqual([connection])
    expect(JSON.stringify(connection)).not.toContain('valid-token')
  })

  it('does not persist an invalid PAT', async () => {
    const fixture = createFixture()

    await expect(
      fixture.service.configure('GITHUB', { token: 'invalid-token' }),
    ).rejects.toMatchObject({ code: 'GIT_CONNECTION_INVALID' })
    expect(fixture.records.size).toBe(0)
    expect(fixture.tokens.size).toBe(0)
  })

  it('lists repositories only while the provider credential exists', async () => {
    const fixture = createFixture()
    await fixture.service.configure('GITHUB', { token: 'valid-token' })

    await expect(fixture.service.listRepositories('GITHUB')).resolves.toMatchObject([
      { remoteId: '123', fullName: 'operator/slopify' },
    ])
    fixture.tokens.clear()
    await expect(fixture.service.listRepositories('GITHUB')).rejects.toBeInstanceOf(
      GitConnectionServiceError,
    )
  })

  it('disconnects the provider and removes its stored credential', async () => {
    const fixture = createFixture()
    await fixture.service.configure('GITHUB', { token: 'valid-token' })

    await fixture.service.disconnect('GITHUB')

    expect(fixture.service.list()).toEqual([])
    expect(fixture.tokens.size).toBe(0)
  })
})
