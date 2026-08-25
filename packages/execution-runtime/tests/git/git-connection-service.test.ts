import type { GitConnection, GitProvider, GitRepository } from '@slopify/contracts'
import { describe, expect, it, vi } from 'vitest'

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
    get: async (provider) => records.get(provider),
    list: async () => [...records.values()],
    save: async (record) => void records.set(record.provider, record),
    delete: async (provider) => records.delete(provider),
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
    connections,
    records,
    secrets,
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
    await expect(fixture.service.list()).resolves.toEqual([connection])
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

  it('removes a new credential when metadata persistence fails', async () => {
    const fixture = createFixture()
    vi.spyOn(fixture.connections, 'save').mockRejectedValueOnce(new Error('settings unavailable'))

    await expect(fixture.service.configure('GITHUB', { token: 'valid-token' })).rejects.toThrow(
      'settings unavailable',
    )

    expect(fixture.records.size).toBe(0)
    expect(fixture.tokens.size).toBe(0)
  })

  it('restores the previous credential when replacing metadata fails', async () => {
    const fixture = createFixture()
    const previous = {
      provider: 'GITHUB' as const,
      accountUsername: 'previous-operator',
      connectedAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
    }
    fixture.records.set('GITHUB', previous)
    fixture.tokens.set('GITHUB', 'previous-token')
    vi.spyOn(fixture.connections, 'save').mockRejectedValueOnce(new Error('settings unavailable'))

    await expect(fixture.service.configure('GITHUB', { token: 'valid-token' })).rejects.toThrow(
      'settings unavailable',
    )

    expect(fixture.records.get('GITHUB')).toEqual(previous)
    expect(fixture.tokens.get('GITHUB')).toBe('previous-token')
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

    await expect(fixture.service.list()).resolves.toEqual([])
    expect(fixture.tokens.size).toBe(0)
  })

  it('restores provider metadata when credential deletion fails', async () => {
    const fixture = createFixture()
    await fixture.service.configure('GITHUB', { token: 'valid-token' })
    vi.spyOn(fixture.secrets, 'delete').mockRejectedValueOnce(new Error('credential unavailable'))

    await expect(fixture.service.disconnect('GITHUB')).rejects.toThrow('credential unavailable')

    await expect(fixture.service.list()).resolves.toHaveLength(1)
    expect(fixture.tokens.get('GITHUB')).toBe('valid-token')
  })

  it('cleans missing and orphaned credential states without exposing a token', async () => {
    const fixture = createFixture()
    await fixture.service.configure('GITHUB', { token: 'valid-token' })
    fixture.tokens.delete('GITHUB')

    await expect(fixture.service.requireToken('GITHUB')).rejects.toMatchObject({
      code: 'GIT_CONNECTION_CREDENTIAL_MISSING',
    })
    await fixture.service.disconnect('GITHUB')
    expect(fixture.records.size).toBe(0)

    fixture.tokens.set('GITHUB', 'orphan-token')
    await expect(fixture.service.requireToken('GITHUB')).rejects.toMatchObject({
      code: 'GIT_CONNECTION_NOT_FOUND',
    })
    await fixture.service.disconnect('GITHUB')
    expect(fixture.tokens.size).toBe(0)
  })
})
