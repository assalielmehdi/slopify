import { HealthResponseSchema } from '@slopify/contracts'
import type { DatabaseStatus, WorkbenchDatabase } from '@slopify/execution-runtime'
import { describe, expect, it, vi } from 'vitest'

import { createApiApp } from '../src/app.js'

const healthyStatus: DatabaseStatus = {
  foreignKeysEnabled: true,
  journalMode: 'wal',
  schemaVersion: 2,
  writable: true,
}

const createDatabase = (
  input: Readonly<{ isOpen?: boolean; status?: () => DatabaseStatus }> = {},
): Pick<WorkbenchDatabase, 'isOpen' | 'status'> => ({
  isOpen: input.isOpen ?? true,
  status: input.status ?? (() => healthyStatus),
})

describe('GET /healthz', () => {
  it('reports healthy when SQLite is open and writable', async () => {
    const response = await createApiApp({ database: createDatabase() }).request('/healthz')

    expect(response.status).toBe(200)
    expect(HealthResponseSchema.parse(await response.json())).toEqual({ status: 'ok' })
  })

  it('ignores unrelated request headers', async () => {
    const response = await createApiApp({ database: createDatabase() }).request('/healthz', {
      headers: { authorization: 'Bearer absent-from-runtime' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('returns the shared error envelope when SQLite is closed', async () => {
    const status = vi.fn(() => healthyStatus)
    const response = await createApiApp({
      database: createDatabase({ isOpen: false, status }),
    }).request('/healthz')

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: { code: 'DATABASE_UNAVAILABLE', message: 'Local persistence is unavailable' },
    })
    expect(status).not.toHaveBeenCalled()
  })

  it('returns no database or secret details when writability cannot be proven', async () => {
    const databasePath = '/private/configured/workbench.sqlite'
    const secret = 'private-host-value'
    const response = await createApiApp({
      database: createDatabase({
        status: () => {
          throw new Error(`${databasePath}:${secret}`)
        },
      }),
    }).request('/healthz')

    const body = await response.text()
    expect(response.status).toBe(503)
    expect(body).not.toContain(databasePath)
    expect(body).not.toContain(secret)
    expect(JSON.parse(body)).toEqual({
      error: { code: 'DATABASE_UNAVAILABLE', message: 'Local persistence is unavailable' },
    })
  })

  it('is unhealthy when the open database is not writable', async () => {
    const response = await createApiApp({
      database: createDatabase({ status: () => ({ ...healthyStatus, writable: false }) }),
    }).request('/healthz')

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } })
  })

  it('reports filesystem health without requiring a database', async () => {
    const response = await createApiApp({
      filesystemHealth: { status: async () => ({ owned: true, writable: true }) },
    }).request('/healthz')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('does not expose filesystem paths when ownership or writability is lost', async () => {
    const privatePath = '/Users/operator/.slopify/runtime/instance.lock'
    const response = await createApiApp({
      filesystemHealth: {
        status: async () => {
          throw new Error(privatePath)
        },
      },
    }).request('/healthz')
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(body).not.toContain(privatePath)
    expect(JSON.parse(body)).toEqual({
      error: { code: 'FILESYSTEM_UNAVAILABLE', message: 'Local persistence is unavailable' },
    })
  })
})
