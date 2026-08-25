import { describe, expect, it, vi } from 'vitest'

import { createApiApp } from '../src/app.js'
import {
  ServerConfigurationError,
  ensureInitialWorkflow,
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
  it('seeds one empty workflow draft exactly once', () => {
    const insert = vi.fn()
    const workflows = {
      insert,
      list: vi.fn(() => []),
    }

    ensureInitialWorkflow(workflows)

    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'default-workflow',
        startNodeId: null,
        nodes: [],
        edges: [],
      }),
    )

    workflows.list.mockReturnValue([insert.mock.calls[0]?.[0]])
    ensureInitialWorkflow(workflows)
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('never adds the default workflow to a non-empty catalog', () => {
    const insert = vi.fn()
    const workflows = {
      insert,
      list: vi.fn(() => [{ workflowId: 'release-workflow' }]),
    }

    ensureInitialWorkflow(workflows)

    expect(insert).not.toHaveBeenCalled()
  })

  it('configures only the database, traces, and cloned workspaces under owner-local state', () => {
    expect(
      resolveApiServerConfiguration({
        API_HOST: '127.0.0.2',
        API_PORT: '4310',
        API_SHUTDOWN_GRACE_MS: '2500',
        DATABASE_PATH: '/var/lib/workbench/workbench.sqlite',
        TRACES_ROOT: '/var/lib/workbench/traces',
        WORKSPACES_ROOT: '/var/lib/workbench/workspaces',
      }),
    ).toEqual({
      hostname: '127.0.0.2',
      port: 4310,
      shutdownGracePeriodMs: 2_500,
      databasePath: '/var/lib/workbench/workbench.sqlite',
      tracesRoot: '/var/lib/workbench/traces',
      workspacesRoot: '/var/lib/workbench/workspaces',
    })
    expect(resolveApiServerConfiguration({ SLOPIFY_HOME: '/tmp/slopify-test' })).toMatchObject({
      hostname: '127.0.0.1',
      port: 3001,
      databasePath: '/tmp/slopify-test/slopify.db',
      tracesRoot: '/tmp/slopify-test/traces',
      workspacesRoot: '/tmp/slopify-test/workspaces',
    })
    expect(resolveApiServerConfiguration({}).databasePath).toMatch(
      /\.slopify\/orchestrator\/slopify\.db$/u,
    )
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

  it('starts the Hono fetch handler on the requested Bun address', async () => {
    const stop = vi.fn(async () => undefined)
    const serve = vi.fn((options: { readonly hostname: string; readonly port: number }) => ({
      hostname: options.hostname,
      port: options.port,
      stop,
    }))
    const server = startApiServer({
      app: createApiApp({ database }),
      configuration: {
        hostname: '127.0.0.1',
        port: 0,
        databasePath: '/unused-in-this-test.sqlite',
        tracesRoot: '/traces',
        workspacesRoot: '/workspaces',
        shutdownGracePeriodMs: 10_000,
      },
      serve,
    })
    expect(server.hostname).toBe('127.0.0.1')
    expect(server.port).toBe(0)
    expect(serve).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: '127.0.0.1', port: 0, fetch: expect.any(Function) }),
    )

    await server.stop()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('disables the idle timeout only for exact GET run event streams', async () => {
    type ServeFactory = NonNullable<Parameters<typeof startApiServer>[0]['serve']>
    type ServeOptions = Parameters<ServeFactory>[0]

    const app = createApiApp({ database })
    const stop = vi.fn(async () => undefined)
    let fetchHandler: ServeOptions['fetch'] | undefined
    const serve: ServeFactory = (options) => {
      fetchHandler = options.fetch
      return {
        hostname: options.hostname,
        port: options.port,
        stop,
      }
    }
    const timeout = vi.fn()
    const requestServer = { timeout } as Parameters<ServeOptions['fetch']>[1]

    startApiServer({
      app,
      configuration: {
        hostname: '127.0.0.1',
        port: 0,
        databasePath: '/unused-in-this-test.sqlite',
        tracesRoot: '/traces',
        workspacesRoot: '/workspaces',
        shutdownGracePeriodMs: 10_000,
      },
      serve,
    })

    const fetch = fetchHandler
    if (fetch === undefined) throw new Error('Expected the API fetch handler to be registered')

    const eventRequest = new Request('http://localhost/api/runs/run-123/events')
    await fetch(eventRequest, requestServer)
    expect(timeout).toHaveBeenCalledOnce()
    expect(timeout).toHaveBeenCalledWith(eventRequest, 0)

    timeout.mockClear()
    await fetch(new Request('http://localhost/healthz'), requestServer)
    await fetch(
      new Request('http://localhost/api/runs/run-123/events', { method: 'POST' }),
      requestServer,
    )
    await fetch(new Request('http://localhost/api/runs/run-123/events/next'), requestServer)
    expect(timeout).not.toHaveBeenCalled()
  })
})
