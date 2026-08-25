import type { GitConnectionService } from '@slopify/execution-runtime'
import { describe, expect, it, vi } from 'vitest'

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

const createConnections = (): GitConnectionService => ({
  configure: vi.fn(async () => connection),
  disconnect: vi.fn(async () => undefined),
  list: vi.fn(async () => [connection]),
  listRepositories: vi.fn(async () => [repository]),
  requireToken: vi.fn(async () => 'secret-token'),
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
})
