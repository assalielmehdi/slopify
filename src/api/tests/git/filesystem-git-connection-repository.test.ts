import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createFilesystemGitConnectionRepository,
  createFilesystemSettingsStore,
  createGitConnectionService,
  resolveSlopifyPaths,
  type GitSecretStore,
  type RemoteGitHost,
} from '../../src/index.js'

const directories: string[] = []
const timestamp = '2026-08-25T10:00:00.000Z'

const createFixture = () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-git-settings-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  const settings = createFilesystemSettingsStore({ paths })
  const connections = createFilesystemGitConnectionRepository({ settings })
  return { connections, home, paths, settings }
}

const allFileContents = (directory: string): string =>
  readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? allFileContents(path) : readFileSync(path, 'utf8')
    })
    .join('\n')

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('filesystem Git connection repository', () => {
  it('upserts and deletes provider metadata without changing other settings', async () => {
    const fixture = createFixture()
    await fixture.settings.write({
      value: {
        schemaVersion: 1,
        appearance: { theme: 'dark' },
        git: {
          connections: [
            {
              provider: 'GITLAB',
              accountUsername: 'gitlab-operator',
              credentialReference: 'credential://dev.slopify.git/gitlab.com',
              connectedAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        },
      },
      expectedRevision: null,
    })
    const connection = {
      provider: 'GITHUB' as const,
      accountUsername: 'operator',
      connectedAt: timestamp,
      updatedAt: timestamp,
    }

    await fixture.connections.save(connection)

    expect(await fixture.connections.get('GITHUB')).toEqual(connection)
    expect(await fixture.connections.list()).toEqual([
      connection,
      expect.objectContaining({ provider: 'GITLAB' }),
    ])
    await fixture.connections.save({
      ...connection,
      accountUsername: 'renamed',
      connectedAt: '2026-08-25T11:00:00.000Z',
      updatedAt: '2026-08-25T12:00:00.000Z',
    })
    expect(await fixture.connections.get('GITHUB')).toMatchObject({
      accountUsername: 'renamed',
      connectedAt: timestamp,
    })

    const saved = await fixture.settings.read()
    expect(saved.value.appearance.theme).toBe('dark')
    expect(saved.value.git.connections).toContainEqual(
      expect.objectContaining({
        provider: 'GITHUB',
        credentialReference: 'credential://dev.slopify.git/github.com',
      }),
    )
    expect(await fixture.connections.delete('GITHUB')).toBe(true)
    expect(await fixture.connections.delete('GITHUB')).toBe(false)
    expect((await fixture.settings.read()).value.git.connections).toHaveLength(1)
  })

  it('keeps PAT bytes outside every file in the Slopify home', async () => {
    const fixture = createFixture()
    const tokens = new Map<string, string>()
    const secrets: GitSecretStore = {
      get: async (provider) => tokens.get(provider) ?? null,
      set: async (provider, token) => void tokens.set(provider, token),
      delete: async (provider) => tokens.delete(provider),
    }
    const remote: RemoteGitHost = {
      authenticate: async (provider) => ({ provider, accountUsername: 'operator' }),
      listRepositories: async () => [],
      getRepository: async () => undefined,
      getDefaultBranchSha: async () => 'a'.repeat(40) as never,
    }
    const service = createGitConnectionService({
      connections: fixture.connections,
      secrets,
      remote,
      now: () => timestamp,
    })

    await service.configure('GITHUB', { token: 'github_pat_never_write_this' })

    expect(tokens.get('GITHUB')).toBe('github_pat_never_write_this')
    expect(allFileContents(fixture.home)).not.toContain('github_pat_never_write_this')
    expect(allFileContents(fixture.home)).toContain('credential://dev.slopify.git/github.com')
  })
})
