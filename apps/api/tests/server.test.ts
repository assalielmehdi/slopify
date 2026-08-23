import { describe, expect, it, vi } from 'vitest'

import { createPredefinedV1Workflow } from '@slopify/workflow-model'

import { createApiApp } from '../src/app.js'
import {
  ServerConfigurationError,
  connectDefaultChatGpt,
  connectDefaultFigma,
  ensurePredefinedWorkflow,
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
    const save = vi.fn()
    const workflows = {
      save,
      get: vi.fn(() => undefined),
    }

    ensurePredefinedWorkflow(workflows)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'delivery-workflow',
        startNodeId: null,
        nodes: [],
        edges: [],
      }),
    )

    workflows.get.mockReturnValue(save.mock.calls[0]?.[0])
    ensurePredefinedWorkflow(workflows)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('migrates only the exact untouched legacy seed to the empty draft', () => {
    const save = vi.fn()
    const legacy = createPredefinedV1Workflow({
      createdAt: '2026-08-20T23:30:00.000Z',
      agentDefaults: {
        provider: 'chatgpt-subscription',
        model: 'gpt-5.4',
        thinkingLevel: 'medium',
      },
    })
    const workflows = {
      save,
      get: vi.fn(() => legacy),
    }

    ensurePredefinedWorkflow(workflows)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0]).toMatchObject({ startNodeId: null, nodes: [], edges: [] })
  })

  it('never overwrites a user-edited workflow resembling the legacy seed', () => {
    const save = vi.fn()
    const legacy = createPredefinedV1Workflow({
      createdAt: '2026-08-20T23:30:00.000Z',
      agentDefaults: {
        provider: 'chatgpt-subscription',
        model: 'gpt-5.4',
        thinkingLevel: 'medium',
      },
    })
    const workflows = {
      save,
      get: vi.fn(() => ({ ...legacy, name: 'My edited workflow' })),
    }

    ensurePredefinedWorkflow(workflows)

    expect(save).not.toHaveBeenCalled()
  })

  it('stores ChatGPT OAuth under the server-owned catalog identity', async () => {
    const connect = vi.fn(async () => ({ connectionId: 'chatgpt-subscription-default' }))

    await expect(
      connectDefaultChatGpt(connect, {
        credential: {
          type: 'oauth',
          access: 'access-token',
          refresh: 'refresh-token',
          expires: Date.now() + 60_000,
        },
      }),
    ).resolves.toEqual({ connectionId: 'chatgpt-subscription-default' })
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'chatgpt-subscription',
      }),
    )
    expect(connect.mock.calls[0]?.[0]).not.toHaveProperty('connectionId')
    expect(connect.mock.calls[0]?.[0]).not.toHaveProperty('label')
  })

  it('connects Figma Desktop under the server-owned catalog identity and MCP endpoint', async () => {
    const connect = vi.fn(async () => ({ connectionId: 'figma-default' }))

    await expect(connectDefaultFigma(connect)).resolves.toEqual({ connectionId: 'figma-default' })
    expect(connect).toHaveBeenCalledWith({
      type: 'figma',
      configuration: { serverUrl: 'http://127.0.0.1:3845/mcp' },
    })
  })

  it('uses native owner-local state and accepts explicit host and port overrides', () => {
    expect(
      resolveApiServerConfiguration({
        API_HOST: '127.0.0.2',
        API_PORT: '4310',
        API_SHUTDOWN_GRACE_MS: '2500',
        DATABASE_PATH: '/var/lib/workbench/workbench.sqlite',
      }),
    ).toEqual({
      hostname: '127.0.0.2',
      port: 4310,
      shutdownGracePeriodMs: 2_500,
      databasePath: '/var/lib/workbench/workbench.sqlite',
      skillsRoot: expect.any(String),
      skillSnapshotsRoot: expect.any(String),
      credentialPath: expect.any(String),
      tracesRoot: expect.any(String),
      guestToolsRoot: expect.any(String),
    })
    expect(resolveApiServerConfiguration({ SLOPIFY_HOME: '/tmp/slopify-test' })).toMatchObject({
      hostname: '127.0.0.1',
      port: 3001,
      databasePath: '/tmp/slopify-test/slopify.db',
      skillsRoot: '/tmp/slopify-test/skills',
      skillSnapshotsRoot: '/tmp/slopify-test/skill-snapshots',
      credentialPath: '/tmp/slopify-test/credentials.json',
      tracesRoot: '/tmp/slopify-test/traces',
      guestToolsRoot: '/tmp/slopify-test/guest-tools',
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
        skillsRoot: '/skills',
        skillSnapshotsRoot: '/skill-snapshots',
        credentialPath: '/credentials.json',
        tracesRoot: '/traces',
        guestToolsRoot: '/guest-tools',
        figmaMcpOAuth: {
          redirectUri: 'http://127.0.0.1:3001/api/connections/figma/oauth/callback',
        },
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
})
