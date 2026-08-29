import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveSlopifyPaths,
  type FilesystemAgentTraceEventFeed,
  type FilesystemRunEventFeed,
  type HarnessAdapter,
  type ResourceEventFeed,
} from '../src/index.js'
import { LiveEventEnvelopeSchema, type AgentExecutor } from '@slopify/shared'
import type { BunWebSocketData } from 'hono/bun'
import { createApiApp } from '../src/app.js'
import {
  ServerConfigurationError,
  createEditableResourceWatcher,
  createSupportedHarnessRuntime,
  resolveApiServerConfiguration,
  startApiServer,
  startConfiguredApiServer,
} from '../src/server.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('API server configuration', () => {
  it('configures only the HTTP server and shutdown grace period', () => {
    expect(
      resolveApiServerConfiguration({
        API_HOST: '127.0.0.2',
        API_PORT: '4310',
        API_SHUTDOWN_GRACE_MS: '2500',
      }),
    ).toEqual({
      hostname: '127.0.0.2',
      port: 4310,
      shutdownGracePeriodMs: 2_500,
    })
    expect(resolveApiServerConfiguration({ SLOPIFY_HOME: '/tmp/slopify-test' })).toEqual({
      hostname: '127.0.0.1',
      port: 7311,
      shutdownGracePeriodMs: 10_000,
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
      app: createApiApp(),
      configuration: {
        hostname: '127.0.0.1',
        port: 0,
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

  it('upgrades run and trace live routes and streams typed event envelopes', async () => {
    const runEvent = {
      schemaVersion: 1,
      eventId: 'run-started',
      runId: 'run-01',
      sequence: 1,
      timestamp: '2026-08-29T10:00:00.000Z',
      type: 'RUN_STARTED',
      data: {},
    } as const
    const traceEvent = {
      sequence: 1,
      timestamp: '2026-08-29T10:00:01.000Z',
      type: 'AGENT_REASONING',
      data: { messageId: 'reasoning-01', content: 'Inspecting the repository.' },
    } as const
    const eventFeed = {
      subscribe: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          yield runEvent
        },
      })),
    } as unknown as FilesystemRunEventFeed
    const traceEvents = {
      subscribe: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          yield traceEvent
        },
      })),
    } as unknown as FilesystemAgentTraceEventFeed
    const server = startApiServer({
      app: createApiApp({ eventFeed, traceEvents }),
      configuration: {
        hostname: '127.0.0.1',
        port: 0,
        shutdownGracePeriodMs: 10_000,
      },
    })
    const receive = (path: string) =>
      new Promise<unknown>((resolve, reject) => {
        const socket = new WebSocket(`ws://${server.hostname}:${server.port}${path}`)
        const timeout = setTimeout(() => {
          socket.close()
          reject(new Error('WebSocket event timed out'))
        }, 2_000)
        socket.addEventListener('message', (event) => {
          clearTimeout(timeout)
          socket.close()
          resolve(LiveEventEnvelopeSchema.parse(JSON.parse(String(event.data))))
        })
        socket.addEventListener('error', () => {
          clearTimeout(timeout)
          reject(new Error('WebSocket connection failed'))
        })
      })

    try {
      await expect(receive('/api/runs/run-01/live?afterSequence=0')).resolves.toEqual({
        type: 'EVENT',
        event: runEvent,
      })
      await expect(
        receive(
          '/api/runs/run-01/node-executions/node-execution-01/trace/live?attemptId=attempt-01&afterSequence=0',
        ),
      ).resolves.toEqual({ type: 'EVENT', event: traceEvent })
      expect(eventFeed.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'run-01', afterSequence: 0 }),
      )
      expect(traceEvents.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-01',
          nodeExecutionId: 'node-execution-01',
          attemptId: 'attempt-01',
          afterSequence: 0,
        }),
      )
    } finally {
      await server.stop(true)
    }
  })

  it('starts the configured application exclusively from filesystem state', async () => {
    const home = mkdtempSync(join(tmpdir(), 'slopify-configured-filesystem-'))
    directories.push(home)
    let fetchHandler:
      | ((
          request: Request,
          server: Bun.Server<BunWebSocketData>,
        ) => Response | Promise<Response>)
      | undefined
    const stop = vi.fn(async () => undefined)
    const serve = vi.fn((options) => {
      fetchHandler = options.fetch
      return { hostname: options.hostname, port: options.port, stop }
    })
    const registerSignals = vi.fn(() => () => undefined)

    const server = await startConfiguredApiServer(
      {
        SLOPIFY_HOME: home,
        API_PORT: '4310',
      },
      { serve, registerSignals, pollIntervalMs: 1_000 },
    )

    expect(fetchHandler).toBeDefined()
    const response = await fetchHandler?.(new Request('http://localhost/healthz'), {
      timeout: vi.fn(),
    } as unknown as Bun.Server<BunWebSocketData>)
    expect(response?.status).toBe(200)
    expect(
      readdirSync(home, { recursive: true }).some((path) => String(path).endsWith('.db')),
    ).toBe(false)
    expect(registerSignals).toHaveBeenCalledOnce()

    await server.stop()
    expect(stop).toHaveBeenCalledOnce()
    expect(await Bun.file(join(home, 'runtime/instance.lock')).exists()).toBe(false)
  })

  it('registers and routes harness adapters without variant-specific branching', async () => {
    const executor = (): AgentExecutor => ({
      execute: async function* () {
        return
      },
      cancel: vi.fn(async () => ({ status: 'cancelled' })),
    })
    const local = executor()
    const adapter: HarnessAdapter = {
      inspector: {
        harnessId: 'local',
        inspect: vi.fn(async () => ({
          harnessId: 'local',
          name: 'Local',
          description: 'Local harness',
          availability: 'UNAVAILABLE' as const,
          unavailableReason: 'Local unavailable',
          installHref: 'https://example.com/',
          installLabel: 'Install Local',
          models: [],
        })),
      },
      executor: local,
    }
    const harnesses = createSupportedHarnessRuntime({
      adapters: [adapter],
    })

    await expect(harnesses.list()).resolves.toMatchObject([{ harnessId: 'local' }])
    expect(harnesses.resolveExecutor('local')).toBe(local)
    expect(harnesses.resolveExecutor('unsupported')).toBeUndefined()
  })

  it('disables the idle timeout only for exact GET event streams', async () => {
    type ServeFactory = NonNullable<Parameters<typeof startApiServer>[0]['serve']>
    type ServeOptions = Parameters<ServeFactory>[0]

    const app = createApiApp()
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
    const resourceEventRequest = new Request('http://localhost/api/resource-events')
    await fetch(resourceEventRequest, requestServer)
    expect(timeout).toHaveBeenCalledOnce()
    expect(timeout).toHaveBeenCalledWith(resourceEventRequest, 0)

    timeout.mockClear()
    await fetch(new Request('http://localhost/healthz'), requestServer)
    await fetch(
      new Request('http://localhost/api/runs/run-123/events', { method: 'POST' }),
      requestServer,
    )
    await fetch(new Request('http://localhost/api/runs/run-123/events/next'), requestServer)
    expect(timeout).not.toHaveBeenCalled()
  })

  it('maps changing files to credential-free editable resource events', async () => {
    const home = mkdtempSync(join(tmpdir(), 'slopify-api-resource-watcher-'))
    directories.push(home)
    const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
    mkdirSync(paths.workflowsDirectory, { recursive: true })
    const publish = vi.fn()
    const events = {
      publish,
      subscribe: vi.fn(),
    } as unknown as ResourceEventFeed
    const watcher = createEditableResourceWatcher({ paths, events })

    await watcher.start()
    writeFileSync(paths.settingsFile, '{"schemaVersion":1}\n')
    const workflow = paths.workflow('review-code')
    mkdirSync(workflow.directory)
    writeFileSync(workflow.definitionFile, '{"schemaVersion":1}\n')
    await watcher.reconcile()

    expect(publish).toHaveBeenCalledWith({
      change: 'CREATED',
      resource: { type: 'SETTINGS' },
      revision: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })
    expect(publish).toHaveBeenCalledWith({
      change: 'CREATED',
      resource: { type: 'WORKFLOW', workflowId: 'review-code' },
      revision: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })
    expect(JSON.stringify(publish.mock.calls)).not.toMatch(/path|token|credential/iu)
    await watcher.stop()
  })
})
