import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFilesystemSettingsStore, resolveSlopifyPaths } from '@slopify/execution-runtime'
import { afterEach, describe, expect, it } from 'vitest'

import { createApiApp } from '../src/app.js'

const directories: string[] = []

const createFixture = () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-settings-api-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  const settings = createFilesystemSettingsStore({ paths })
  return { app: createApiApp({ settings }), paths, settings }
}

const patchSettings = (app: ReturnType<typeof createApiApp>, etag: string | null, theme: string) =>
  app.request('/api/settings', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(etag === null ? {} : { 'if-match': etag }),
    },
    body: JSON.stringify({ appearance: { theme } }),
  })

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('settings API', () => {
  it('returns the default settings with a strong missing-resource ETag', async () => {
    const { app } = createFixture()

    const response = await app.request('/api/settings')

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"missing"')
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      appearance: { theme: 'system' },
      git: { connections: [] },
    })
  })

  it('omits internal credential references from Git metadata', async () => {
    const { app, settings } = createFixture()
    await settings.write({
      value: {
        schemaVersion: 1,
        appearance: { theme: 'light' },
        git: {
          connections: [
            {
              provider: 'GITHUB',
              accountUsername: 'operator',
              credentialReference: 'credential://github',
              connectedAt: '2026-08-25T10:00:00.000Z',
              updatedAt: '2026-08-25T10:00:00.000Z',
            },
          ],
        },
      },
      expectedRevision: null,
    })

    const response = await app.request('/api/settings')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      git: { connections: [{ provider: 'GITHUB', accountUsername: 'operator' }] },
    })
    expect(JSON.stringify(body)).not.toContain('credential://github')
  })

  it('updates appearance with If-Match and rejects a stale external edit', async () => {
    const { app, paths } = createFixture()
    const initial = await app.request('/api/settings')
    const initialEtag = initial.headers.get('etag')

    const updated = await patchSettings(app, initialEtag, 'dark')

    expect(updated.status).toBe(200)
    expect(updated.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/u)
    expect(await updated.json()).toMatchObject({ appearance: { theme: 'dark' } })

    const external = {
      schemaVersion: 1,
      appearance: { theme: 'system' },
      git: { connections: [] },
    }
    const externalSource = `${JSON.stringify(external, null, 2)}\n`
    writeFileSync(paths.settingsFile, externalSource)
    const stale = await patchSettings(app, updated.headers.get('etag'), 'light')

    expect(stale.status).toBe(412)
    expect(await stale.json()).toMatchObject({ error: { code: 'SETTINGS_REVISION_CONFLICT' } })
    expect(readFileSync(paths.settingsFile, 'utf8')).toBe(externalSource)
  })

  it('requires If-Match and returns a stable invalid-file error', async () => {
    const { app, paths } = createFixture()
    const missingPrecondition = await patchSettings(app, null, 'dark')
    expect(missingPrecondition.status).toBe(428)
    expect(await missingPrecondition.json()).toMatchObject({
      error: { code: 'SETTINGS_PRECONDITION_REQUIRED' },
    })

    const source = '{'
    writeFileSync(paths.settingsFile, source)
    const invalid = await app.request('/api/settings')
    expect(invalid.status).toBe(409)
    expect(await invalid.json()).toMatchObject({ error: { code: 'SETTINGS_FILE_INVALID' } })
    expect(readFileSync(paths.settingsFile, 'utf8')).toBe(source)
  })
})
