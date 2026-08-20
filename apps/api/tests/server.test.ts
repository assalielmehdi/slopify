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

  it('binds all interfaces by default in container mode', () => {
    expect(resolveApiServerConfiguration({ API_CONTAINER_MODE: 'true' })).toMatchObject({
      hostname: '0.0.0.0',
      port: 3001,
      databasePath: '/var/lib/workbench/workbench.sqlite',
      workspaceRoot: '/workspace',
      shutdownGracePeriodMs: 10_000,
    })
  })

  it('uses loopback natively and accepts explicit host and port overrides', () => {
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
    })
    expect(resolveApiServerConfiguration({})).toMatchObject({ hostname: '127.0.0.1' })
  })

  it.each(['/tmp/workbench.sqlite', '/var/lib/workbench/../escape.sqlite'])(
    'rejects container database path %j outside the writable data root',
    (DATABASE_PATH) => {
      expect(() =>
        resolveApiServerConfiguration({ API_CONTAINER_MODE: 'true', DATABASE_PATH }),
      ).toThrowError(expect.objectContaining({ code: 'DATABASE_PATH_INVALID' }))
    },
  )

  it.each(['/tmp/workspace', '/workspace/../escape'])(
    'rejects container workspace root %j outside the mounted workspace root',
    (WORKSPACE_ROOT) => {
      expect(() =>
        resolveApiServerConfiguration({ API_CONTAINER_MODE: 'true', WORKSPACE_ROOT }),
      ).toThrowError(expect.objectContaining({ code: 'WORKSPACE_ROOT_INVALID' }))
    },
  )

  it('accepts container paths below the approved data and workspace roots', () => {
    expect(
      resolveApiServerConfiguration({
        API_CONTAINER_MODE: 'true',
        DATABASE_PATH: '/var/lib/workbench/team/workbench.sqlite',
        WORKSPACE_ROOT: '/workspace/team',
      }),
    ).toMatchObject({
      databasePath: '/var/lib/workbench/team/workbench.sqlite',
      workspaceRoot: '/workspace/team',
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
      CLICKUP_API_TOKEN: 'clickup-secret',
      GITLAB_TOKEN: '',
      MODEL_PROVIDER_API_KEY: 'provider-secret',
    })

    expect(status).toEqual({ clickup: true, gitlab: false, modelProvider: true })
    expect(JSON.stringify(status)).not.toContain('clickup-secret')
    expect(JSON.stringify(status)).not.toContain('provider-secret')
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
