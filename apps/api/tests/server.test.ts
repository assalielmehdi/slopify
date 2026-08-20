import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'

import { createApiApp } from '../src/app.js'
import {
  ServerConfigurationError,
  createConfiguredTaskResolver,
  ensurePredefinedWorkflow,
  resolveConnectorStatus,
  resolveApiServerConfiguration,
  startApiServer,
} from '../src/server.js'

const database = {
  isOpen: true,
  status: () => ({
    foreignKeysEnabled: true,
    journalMode: 'wal',
    schemaVersion: 2,
    writable: true,
  }),
}

describe('API server configuration', () => {
  it('seeds the source-controlled V1 workflow exactly once', () => {
    const addRevision = vi.fn()
    const workflows = {
      addRevision,
      getRevision: vi.fn(() => undefined),
    }

    ensurePredefinedWorkflow(workflows)

    expect(addRevision).toHaveBeenCalledTimes(1)
    expect(addRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'delivery-workflow',
        revisionId: 'revision-01',
        startNodeId: 'load-clickup-task',
      }),
    )

    workflows.getRevision.mockReturnValue(addRevision.mock.calls[0]?.[0])
    ensurePredefinedWorkflow(workflows)
    expect(addRevision).toHaveBeenCalledTimes(1)
  })

  it('uses native owner-local state and accepts explicit host and port overrides', () => {
    expect(
      resolveApiServerConfiguration({
        API_HOST: '127.0.0.2',
        API_PORT: '4310',
        API_SHUTDOWN_GRACE_MS: '2500',
        DATABASE_PATH: '/var/lib/workbench/workbench.sqlite',
        WORKSPACE_ROOT: '/custom/workspace',
      }),
    ).toEqual({
      hostname: '127.0.0.2',
      port: 4310,
      shutdownGracePeriodMs: 2_500,
      databasePath: '/var/lib/workbench/workbench.sqlite',
      workspaceRoot: '/custom/workspace',
      skillsRoot: expect.any(String),
      skillSnapshotsRoot: expect.any(String),
      credentialPath: expect.any(String),
    })
    expect(resolveApiServerConfiguration({ SLOPIFY_HOME: '/tmp/slopify-test' })).toMatchObject({
      hostname: '127.0.0.1',
      port: 3001,
      databasePath: '/tmp/slopify-test/slopify.db',
      workspaceRoot: '/tmp/slopify-test/workspaces',
      skillsRoot: '/tmp/slopify-test/skills',
      skillSnapshotsRoot: '/tmp/slopify-test/skill-snapshots',
      credentialPath: '/tmp/slopify-test/credentials.json',
    })
  })

  it.each(['0', '65536', '3.14', 'invalid'])(
    'rejects invalid API_PORT %j with a stable configuration error',
    (API_PORT) => {
      expect(() => resolveApiServerConfiguration({ API_PORT })).toThrowError(
        expect.objectContaining({ code: 'API_PORT_INVALID' }),
      )
      expect(() => resolveApiServerConfiguration({ API_PORT })).toThrow(ServerConfigurationError)
    },
  )

  it.each(['0', '300001', '3.14', 'invalid'])(
    'rejects invalid API_SHUTDOWN_GRACE_MS %j with a stable configuration error',
    (API_SHUTDOWN_GRACE_MS) => {
      expect(() => resolveApiServerConfiguration({ API_SHUTDOWN_GRACE_MS })).toThrowError(
        expect.objectContaining({ code: 'API_SHUTDOWN_GRACE_INVALID' }),
      )
    },
  )

  it('starts the Hono fetch handler on the requested address', async () => {
    const server = startApiServer({
      app: createApiApp({ database }),
      configuration: {
        hostname: '127.0.0.1',
        port: 0,
        databasePath: '/unused-in-this-test.sqlite',
        workspaceRoot: '/workspace',
        skillsRoot: '/skills',
        skillSnapshotsRoot: '/skill-snapshots',
        credentialPath: '/credentials.json',
        shutdownGracePeriodMs: 10_000,
      },
    })
    if (!server.listening) await once(server, 'listening')

    const address = server.address() as AddressInfo
    expect(address.address).toBe('127.0.0.1')
    expect(address.port).toBeGreaterThan(0)

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)))
    })
  })

  it('reduces connector credentials to non-secret readiness booleans', () => {
    const status = resolveConnectorStatus({
      list: () =>
        [
          { type: 'clickup', status: 'CONNECTED' },
          { type: 'gitlab', status: 'INVALID' },
          { type: 'openrouter', status: 'CONNECTED' },
        ] as never,
    })

    expect(status).toEqual({ clickup: true, gitlab: false, modelProvider: true })
    expect(JSON.stringify(status)).not.toContain('credential')
  })

  it('creates ClickUp task clients with profile-scoped workspace context', async () => {
    const getTask = vi.fn(async (taskReference: string) => ({
      taskId: '86abc123',
      title: `Resolved ${taskReference}`,
    }))
    const createClient = vi.fn(() => ({ getTask }))
    const resolver = createConfiguredTaskResolver(
      { CLICKUP_API_TOKEN: 'clickup-secret' },
      createClient,
    )

    const snapshot = await resolver.resolve('CU-123', {
      clickupWorkspaceId: 'workspace-01',
    })

    expect(snapshot).toEqual({ taskId: '86abc123', title: 'Resolved CU-123' })
    expect(createClient).toHaveBeenCalledWith({
      token: 'clickup-secret',
      workspaceId: 'workspace-01',
    })
    expect(getTask).toHaveBeenCalledWith('CU-123')
    expect(JSON.stringify(snapshot)).not.toContain('clickup-secret')
  })

  it('forwards an explicit ClickUp base URL to an isolated provider boundary', async () => {
    const getTask = vi.fn(async () => ({ taskId: '86abc123' }))
    const createClient = vi.fn(() => ({ getTask }))
    const resolver = createConfiguredTaskResolver(
      {
        CLICKUP_API_BASE_URL: 'http://127.0.0.1:4555/api/v2/',
        CLICKUP_API_TOKEN: 'fake-clickup-secret',
      },
      createClient,
    )

    await resolver.resolve('CU-123', { clickupWorkspaceId: 'workspace-01' })

    expect(createClient).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:4555/api/v2/',
      token: 'fake-clickup-secret',
      workspaceId: 'workspace-01',
    })
  })

  it('treats a blank optional ClickUp base URL as the provider default', async () => {
    const getTask = vi.fn(async () => ({ taskId: '86abc123' }))
    const createClient = vi.fn(() => ({ getTask }))
    const resolver = createConfiguredTaskResolver(
      { CLICKUP_API_BASE_URL: '  ', CLICKUP_API_TOKEN: 'clickup-secret' },
      createClient,
    )

    await resolver.resolve('CU-123', { clickupWorkspaceId: 'workspace-01' })

    expect(createClient).toHaveBeenCalledWith({
      token: 'clickup-secret',
      workspaceId: 'workspace-01',
    })
  })
})
