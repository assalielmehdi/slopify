import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createFilesystemSettingsStore,
  resolveSlopifyPaths,
  type SettingsStoreError,
} from '../../src/index.js'

const directories: string[] = []

const createFixture = () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-settings-store-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  return { paths, store: createFilesystemSettingsStore({ paths }) }
}

const rejectsWith = async (promise: Promise<unknown>, code: SettingsStoreError['code']) => {
  await expect(promise).rejects.toMatchObject({ name: 'SettingsStoreError', code })
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('filesystem settings store', () => {
  it('returns system defaults without creating a missing settings file', async () => {
    const { paths, store } = createFixture()

    await expect(store.read()).resolves.toEqual({
      value: {
        schemaVersion: 1,
        appearance: { theme: 'system' },
        git: { connections: [] },
      },
      revision: null,
    })
    expect(existsSync(paths.settingsFile)).toBe(false)
  })

  it('creates and reads revisioned settings', async () => {
    const { paths, store } = createFixture()
    const value = {
      schemaVersion: 1 as const,
      appearance: { theme: 'dark' as const },
      git: { connections: [] },
    }

    const written = await store.write({ value, expectedRevision: null })

    expect(written).toMatchObject({ value, revision: expect.stringMatching(/^[a-f0-9]{64}$/u) })
    await expect(store.read()).resolves.toEqual(written)
    expect(JSON.parse(readFileSync(paths.settingsFile, 'utf8'))).toEqual(value)
  })

  it('loads valid external edits and protects them from stale writes', async () => {
    const { paths, store } = createFixture()
    const initial = await store.write({
      value: {
        schemaVersion: 1,
        appearance: { theme: 'light' },
        git: { connections: [] },
      },
      expectedRevision: null,
    })
    const external = {
      schemaVersion: 1,
      appearance: { theme: 'system' },
      git: { connections: [] },
    }
    const externalSource = `${JSON.stringify(external, null, 2)}\n`
    writeFileSync(paths.settingsFile, externalSource)

    await expect(store.read()).resolves.toMatchObject({ value: external })
    await rejectsWith(
      store.write({
        value: {
          schemaVersion: 1,
          appearance: { theme: 'dark' },
          git: { connections: [] },
        },
        expectedRevision: initial.revision,
      }),
      'SETTINGS_REVISION_CONFLICT',
    )
    expect(readFileSync(paths.settingsFile, 'utf8')).toBe(externalSource)
  })

  it.each([
    ['RESOURCE_MALFORMED', '{'],
    [
      'RESOURCE_VALIDATION_FAILED',
      JSON.stringify({
        schemaVersion: 1,
        appearance: { theme: 'automatic' },
        git: { connections: [] },
      }),
    ],
  ] as const)('surfaces %s without modifying the invalid file', async (causeCode, source) => {
    const { paths, store } = createFixture()
    writeFileSync(paths.settingsFile, source)

    await expect(store.read()).rejects.toMatchObject({
      name: 'SettingsStoreError',
      code: 'SETTINGS_FILE_INVALID',
      cause: { code: causeCode },
    })

    expect(readFileSync(paths.settingsFile, 'utf8')).toBe(source)
  })
})
