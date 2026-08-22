import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createFileCredentialStore } from '../../src/index.js'

const roots: string[] = []
const createStore = async () => {
  const root = await mkdtemp(join(tmpdir(), 'slopify-credentials-'))
  roots.push(root)
  const path = join(root, '.slopify', 'credentials.json')
  return { path, store: createFileCredentialStore({ path }) }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('file credential store', () => {
  it('writes owner-only credentials atomically and never exposes all values', async () => {
    const { path, store } = await createStore()
    await store.modify('openrouter-primary', async () => ({ type: 'api_key', key: 'sk-secret' }))

    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      'openrouter-primary': { type: 'api_key', key: 'sk-secret' },
    })
    expect('list' in store).toBe(false)
  })

  it('serializes concurrent modifications without losing credentials', async () => {
    const { store } = await createStore()
    await Promise.all([
      store.modify('gitlab-primary', async () => ({ type: 'api_key', key: 'glpat-secret' })),
      store.modify('clickup-primary', async () => ({ type: 'api_key', key: 'pk-secret' })),
      store.modify('chatgpt-primary', async () => ({
        type: 'oauth',
        access: 'access-secret',
        refresh: 'refresh-secret',
        expires: 2_000_000_000_000,
        accountId: 'account-01',
      })),
    ])

    expect(await store.read('gitlab-primary')).toEqual({ type: 'api_key', key: 'glpat-secret' })
    expect(await store.read('clickup-primary')).toEqual({ type: 'api_key', key: 'pk-secret' })
    expect(await store.read('chatgpt-primary')).toEqual({
      type: 'oauth',
      access: 'access-secret',
      refresh: 'refresh-secret',
      expires: 2_000_000_000_000,
      accountId: 'account-01',
    })
  })

  it('deletes disconnected credentials', async () => {
    const { store } = await createStore()
    await store.modify('connection', async () => ({ type: 'api_key', key: 'secret' }))
    await store.delete('connection')
    expect(await store.read('connection')).toBeUndefined()
  })
})
