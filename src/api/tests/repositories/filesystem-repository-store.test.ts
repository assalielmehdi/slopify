import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createFilesystemRepositoryStore,
  resolveSlopifyPaths,
  type RepositoryRecord,
} from '../../src/index.js'

const directories: string[] = []
const record = (overrides: Partial<RepositoryRecord> = {}): RepositoryRecord => ({
  repositoryId: 'repository-01',
  name: 'slopify',
  provider: 'GITHUB',
  remoteId: '123',
  fullName: 'operator/slopify',
  cloneUrl: 'https://github.com/operator/slopify.git',
  webUrl: 'https://github.com/operator/slopify',
  defaultBranch: 'main',
  createdAt: '2026-08-25T10:00:00.000Z',
  updatedAt: '2026-08-25T10:00:00.000Z',
  ...overrides,
})

const createFixture = () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-repositories-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  return { home, paths, repositories: createFilesystemRepositoryStore({ paths }) }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('filesystem repository store', () => {
  it('atomically adds, finds, lists, and immediately deletes repositories', async () => {
    const fixture = createFixture()
    await expect(fixture.repositories.list()).resolves.toEqual([])

    await fixture.repositories.add(record())
    await fixture.repositories.add(
      record({
        repositoryId: 'repository-02',
        provider: 'GITLAB',
        remoteId: '456',
        fullName: 'operator/api',
        cloneUrl: 'https://gitlab.com/operator/api.git',
        webUrl: 'https://gitlab.com/operator/api',
        createdAt: '2026-08-25T11:00:00.000Z',
        updatedAt: '2026-08-25T11:00:00.000Z',
      }),
    )

    await expect(fixture.repositories.get('repository-01')).resolves.toEqual(record())
    await expect(fixture.repositories.findByRemote('GITHUB', '123')).resolves.toEqual(record())
    await expect(fixture.repositories.list()).resolves.toMatchObject([
      { repositoryId: 'repository-01' },
      { repositoryId: 'repository-02' },
    ])
    await expect(
      fixture.repositories.add(record({ repositoryId: 'repository-03' })),
    ).rejects.toMatchObject({ code: 'REPOSITORY_CONFLICT' })
    await expect(fixture.repositories.add(record({ remoteId: '789' }))).rejects.toMatchObject({
      code: 'REPOSITORY_CONFLICT',
    })

    await expect(fixture.repositories.delete('repository-01')).resolves.toBe(true)
    await expect(fixture.repositories.delete('repository-01')).resolves.toBe(false)
    await expect(fixture.repositories.list()).resolves.toMatchObject([
      { repositoryId: 'repository-02' },
    ])
    expect(JSON.parse(readFileSync(fixture.paths.repositoriesFile, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      repositories: [{ repositoryId: 'repository-02' }],
    })
  })

  it('rejects the whole externally edited resource when any entry is invalid', async () => {
    const fixture = createFixture()
    const invalidSource = `${JSON.stringify(
      {
        schemaVersion: 1,
        repositories: [record(), { ...record(), repositoryId: 'repository-02' }],
      },
      null,
      2,
    )}\n`
    writeFileSync(fixture.paths.repositoriesFile, invalidSource)

    await expect(fixture.repositories.list()).rejects.toMatchObject({
      code: 'REPOSITORIES_FILE_INVALID',
    })
    expect(readFileSync(fixture.paths.repositoriesFile, 'utf8')).toBe(invalidSource)
  })

  it('serializes concurrent writers without losing either update', async () => {
    const fixture = createFixture()
    await fixture.repositories.add(record())

    const results = await Promise.allSettled([
      fixture.repositories.add(
        record({ repositoryId: 'repository-02', provider: 'GITLAB', remoteId: '456' }),
      ),
      fixture.repositories.add(
        record({ repositoryId: 'repository-03', provider: 'GITLAB', remoteId: '789' }),
      ),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(2)
    await expect(fixture.repositories.list()).resolves.toHaveLength(3)
  })
})
