import { describe, expect, it, vi } from 'vitest'

import { createApiApp } from '../src/app.js'
import {
  ServerConfigurationError,
  connectDefaultChatGpt,
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
  it('seeds the source-controlled V1 workflow exactly once', () => {
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
        startNodeId: 'identify-agent',
      }),
    )
    expect(save.mock.calls[0]?.[0].nodes[0]).toMatchObject({
      type: 'agent',
      job: {
        prompt: "Who are you? What's your name?",
        inference: {
          connectionId: 'chatgpt-subscription-default',
          modelId: 'gpt-5.4',
        },
      },
    })

    workflows.get.mockReturnValue(save.mock.calls[0]?.[0])
    ensurePredefinedWorkflow(workflows)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('replaces only the legacy seeded workflow that still has synthetic nodes', () => {
    const save = vi.fn()
    const workflows = {
      save,
      get: vi.fn(() => ({
        workflowId: 'delivery-workflow',
        name: 'Who are you?',
        nodes: [
          { type: 'agent', id: 'identify-agent' },
          { type: 'terminal', id: 'succeeded' },
        ],
        edges: [
          {
            sourceNodeId: 'identify-agent',
            outcome: 'completed',
            targetNodeId: 'succeeded',
          },
        ],
      })),
    }

    ensurePredefinedWorkflow(workflows)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0].nodes).toEqual([
      expect.objectContaining({ type: 'agent', id: 'identify-agent' }),
    ])
  })

  it('stores ChatGPT OAuth as the inference connection used by the default workflow', async () => {
    const connect = vi.fn(async (input) => ({ connectionId: input.connectionId }))

    await expect(
      connectDefaultChatGpt(connect, {
        label: 'ChatGPT subscription',
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
        connectionId: 'chatgpt-subscription-default',
        type: 'chatgpt-subscription',
      }),
    )
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
    })
    expect(resolveApiServerConfiguration({ SLOPIFY_HOME: '/tmp/slopify-test' })).toMatchObject({
      hostname: '127.0.0.1',
      port: 3001,
      databasePath: '/tmp/slopify-test/slopify.db',
      skillsRoot: '/tmp/slopify-test/skills',
      skillSnapshotsRoot: '/tmp/slopify-test/skill-snapshots',
      credentialPath: '/tmp/slopify-test/credentials.json',
      tracesRoot: '/tmp/slopify-test/traces',
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
