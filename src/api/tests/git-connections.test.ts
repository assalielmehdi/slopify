import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createFilesystemGitConnectionRepository,
  createFilesystemSettingsStore,
  createGitConnectionService,
  resolveSlopifyPaths,
  type GitConnectionService,
  type GitSecretStore,
  type RemoteGitHost,
} from '../src/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApiApp } from '../src/app.js'

const connection = {
  provider: 'GITHUB' as const,
  accountUsername: 'operator',
  connectedAt: '2026-08-24T00:00:00Z',
  updatedAt: '2026-08-24T00:00:00Z',
}

const repository = {
  provider: 'GITHUB' as const,
  remoteId: '123',
  name: 'slopify',
  fullName: 'operator/slopify',
  cloneUrl: 'https://github.com/operator/slopify.git',
  webUrl: 'https://github.com/operator/slopify',
  visibility: 'PRIVATE' as const,
  defaultBranch: 'main',
}

const directories: string[] = []

const createConnections = (): GitConnectionService => ({
  configure: vi.fn(async () => connection),
  disconnect: vi.fn(async () => undefined),
  list: vi.fn(async () => [connection]),
  listRepositories: vi.fn(async () => [repository]),
  requireToken: vi.fn(async () => 'secret-token'),
})

const createFileBackedConnections = () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-git-api-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  const settings = createFilesystemSettingsStore({ paths })
  const tokens = new Map<string, string>()
  const secrets: GitSecretStore = {
    get: async (provider) => tokens.get(provider) ?? null,
    set: async (provider, token) => void tokens.set(provider, token),
    delete: async (provider) => tokens.delete(provider),
  }
  const remote: RemoteGitHost = {
    authenticate: vi.fn(async (provider, token) => {
      if (token !== 'secret-token') throw new Error(`rejected ${token}`)
      return { provider, accountUsername: 'operator' }
    }),
    listRepositories: vi.fn(async () => [repository]),
    getRepository: vi.fn(async () => repository),
    getDefaultBranchSha: vi.fn(async () => 'a'.repeat(40) as never),
  }
  const service = createGitConnectionService({
    connections: createFilesystemGitConnectionRepository({ settings }),
    secrets,
    remote,
    now: () => connection.connectedAt,
  })
  return { app: createApiApp({ gitConnections: service }), paths, remote, tokens }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Git connections API', () => {
  it('configures, lists, and disconnects a provider without returning its token', async () => {
    const connections = createConnections()
    const app = createApiApp({ gitConnections: connections })

    const configured = await app.request('/api/git/connections/GITHUB', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'secret-token' }),
    })
    const listed = await app.request('/api/git/connections')
    const disconnected = await app.request('/api/git/connections/GITHUB', { method: 'DELETE' })

    expect(configured.status).toBe(200)
    expect(await configured.json()).toEqual(connection)
    expect(JSON.stringify(await listed.json())).not.toContain('secret-token')
    expect(disconnected.status).toBe(204)
    expect(connections.configure).toHaveBeenCalledWith('GITHUB', { token: 'secret-token' })
    expect(connections.disconnect).toHaveBeenCalledWith('GITHUB')
  })

  it('lists repositories available through a connected provider', async () => {
    const connections = createConnections()
    const response = await createApiApp({ gitConnections: connections }).request(
      '/api/git/connections/GITHUB/repositories',
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ repositories: [repository] })
    expect(connections.listRepositories).toHaveBeenCalledWith('GITHUB')
  })

  it('preserves endpoint contracts while persisting only file-backed metadata', async () => {
    const fixture = createFileBackedConnections()

    const configured = await fixture.app.request('/api/git/connections/GITHUB', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'secret-token' }),
    })
    const listed = await fixture.app.request('/api/git/connections')
    const discovered = await fixture.app.request('/api/git/connections/GITHUB/repositories')

    expect(configured.status).toBe(200)
    expect(await configured.json()).toEqual(connection)
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({ connections: [connection] })
    expect(discovered.status).toBe(200)
    expect(await discovered.json()).toEqual({ repositories: [repository] })
    expect(fixture.tokens.get('GITHUB')).toBe('secret-token')
    const settingsSource = readFileSync(fixture.paths.settingsFile, 'utf8')
    expect(settingsSource).toContain('credential://dev.slopify.git/github.com')
    expect(settingsSource).not.toContain('secret-token')

    const disconnected = await fixture.app.request('/api/git/connections/GITHUB', {
      method: 'DELETE',
    })
    const afterDisconnect = await fixture.app.request('/api/git/connections')
    expect(disconnected.status).toBe(204)
    expect(await afterDisconnect.json()).toEqual({ connections: [] })
    expect(fixture.tokens.size).toBe(0)
  })

  it('returns bounded errors for missing credentials and provider failures', async () => {
    const fixture = createFileBackedConnections()
    await fixture.app.request('/api/git/connections/GITHUB', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'secret-token' }),
    })

    fixture.tokens.clear()
    const missing = await fixture.app.request('/api/git/connections/GITHUB/repositories')
    const missingBody = JSON.stringify(await missing.json())
    expect(missing.status).toBe(409)
    expect(missingBody).toContain('GIT_CONNECTION_CREDENTIAL_MISSING')
    expect(missingBody).not.toContain('credential://')
    expect(missingBody).not.toContain('secret-token')

    fixture.tokens.set('GITHUB', 'secret-token')
    vi.mocked(fixture.remote.listRepositories).mockRejectedValueOnce(
      new Error('https://x-access-token:secret-token@github.com/private/repository.git'),
    )
    const unavailable = await fixture.app.request('/api/git/connections/GITHUB/repositories')
    const unavailableBody = JSON.stringify(await unavailable.json())
    expect(unavailable.status).toBe(503)
    expect(unavailableBody).toContain('GIT_PROVIDER_UNAVAILABLE')
    expect(unavailableBody).not.toContain('x-access-token')
    expect(unavailableBody).not.toContain('secret-token')
    expect(unavailableBody).not.toContain('@github.com')
  })
})
