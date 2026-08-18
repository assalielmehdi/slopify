import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'

import { createApiApp } from '../src/app.js'
import {
  ServerConfigurationError,
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
  it('binds all interfaces by default in container mode', () => {
    expect(resolveApiServerConfiguration({ API_CONTAINER_MODE: 'true' })).toMatchObject({
      hostname: '0.0.0.0',
      port: 3001,
    })
  })

  it('uses loopback natively and accepts explicit host and port overrides', () => {
    expect(
      resolveApiServerConfiguration({
        API_HOST: '127.0.0.2',
        API_PORT: '4310',
        DATABASE_PATH: '/var/lib/workbench/workbench.sqlite',
      }),
    ).toEqual({
      hostname: '127.0.0.2',
      port: 4310,
      databasePath: '/var/lib/workbench/workbench.sqlite',
    })
    expect(resolveApiServerConfiguration({})).toMatchObject({ hostname: '127.0.0.1' })
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

  it('starts the Hono fetch handler on the requested address', async () => {
    const server = startApiServer({
      app: createApiApp({ database }),
      configuration: {
        hostname: '127.0.0.1',
        port: 0,
        databasePath: '/unused-in-this-test.sqlite',
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
})
