import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createFilesystemRepositoryStore,
  createFilesystemSettingsStore,
  createFilesystemWorkflowStore,
  createLegacyCatalogConverter,
  createLegacyMigrationInstaller,
  createLegacyMigrationService,
  openDatabase,
  resolveSlopifyPaths,
} from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'

const roots: string[] = []

const workflow = {
  schemaVersion: 1,
  workflowId: 'release-review',
  name: 'Release review',
  description: 'Review a release.',
  configuration: {
    projectIds: ['repository-api'],
    primaryProjectId: 'repository-api',
    variables: [],
  },
  startNodeId: 'review',
  nodes: [
    {
      type: 'agent',
      id: 'review',
      name: 'Review',
      prompt: 'Review the release.',
      harness: { harnessId: 'pi' },
    },
  ],
  edges: [],
  maxTransitions: 0,
  createdAt: '2026-08-20T12:00:00.000Z',
  updatedAt: '2026-08-21T12:00:00.000Z',
} as const

const expected = {
  connections: 1,
  repositories: 1,
  workflows: 1,
  runs: 0,
  nodes: 0,
  traces: 0,
} as const

const createFixture = async (includeWorkflow = true) => {
  const root = join(tmpdir(), `slopify-install-migration-${crypto.randomUUID()}`)
  roots.push(root)
  mkdirSync(root, { recursive: true })
  const databasePath = join(root, 'legacy.sqlite')
  const database = openDatabase({ path: databasePath })
  const connection = getDatabaseHandle(database)
  connection
    .prepare(
      `INSERT INTO git_connections (
         provider, account_username, connected_at, updated_at
       ) VALUES (?, ?, ?, ?)`,
    )
    .run('GITHUB', 'operator', '2026-08-20T10:00:00.000Z', '2026-08-21T10:00:00.000Z')
  connection
    .prepare(
      `INSERT INTO repositories (
         repository_id, name, provider, remote_id, repository_full_name,
         clone_url, web_url, default_branch, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'repository-api',
      'API',
      'GITHUB',
      '100',
      'operator/api',
      'https://github.com/operator/api.git',
      'https://github.com/operator/api',
      'main',
      '2026-08-20T11:00:00.000Z',
      '2026-08-21T11:00:00.000Z',
    )
  if (includeWorkflow)
    connection
      .prepare('INSERT INTO workflows (workflow_id, definition_json) VALUES (?, json(?))')
      .run(workflow.workflowId, JSON.stringify(workflow))
  database.close()

  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: join(root, 'home') } })
  const preparation = await createLegacyMigrationService({
    databasePath,
    paths,
    createMigrationId: () => 'sqlite-v4-install',
    now: () => '2026-08-25T12:00:00.000Z',
  }).prepare()
  await createLegacyCatalogConverter({ preparation }).convert()
  return { databasePath, paths, preparation }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('legacy migration installer', () => {
  it('validates counts, references, schemas, and hashes before installing targets', async () => {
    const fixture = await createFixture()

    const manifest = await createLegacyMigrationInstaller({
      paths: fixture.paths,
      preparation: fixture.preparation,
      expected,
      now: () => '2026-08-25T13:00:00.000Z',
    }).install()

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      state: 'INSTALLED',
      counts: expected,
      targets: [
        { relativePath: 'settings.json' },
        { relativePath: 'repositories.json' },
        { relativePath: 'workflows' },
      ],
    })
    expect(manifest.files.length).toBeGreaterThanOrEqual(3)
    expect(manifest.files.every(({ sha256 }) => /^[0-9a-f]{64}$/.test(sha256))).toBe(true)
    await expect(
      createFilesystemSettingsStore({ paths: fixture.paths }).read(),
    ).resolves.toMatchObject({ value: { git: { connections: [{ provider: 'GITHUB' }] } } })
    await expect(createFilesystemRepositoryStore({ paths: fixture.paths }).list()).resolves.toEqual(
      [expect.objectContaining({ repositoryId: 'repository-api' })],
    )
    await expect(createFilesystemWorkflowStore({ paths: fixture.paths }).list()).resolves.toEqual([
      expect.objectContaining({ status: 'VALID' }),
    ])
  })

  it('installs nothing when complete export validation fails', async () => {
    const fixture = await createFixture()
    await writeFile(
      join(fixture.preparation.exportDirectory, 'workflows/release-review/workflow.json'),
      '{"schemaVersion":2,"invalid":true}\n',
    )

    await expect(
      createLegacyMigrationInstaller({
        paths: fixture.paths,
        preparation: fixture.preparation,
        expected,
      }).install(),
    ).rejects.toMatchObject({ code: 'INVALID_EXPORT' })
    expect(existsSync(fixture.paths.settingsFile)).toBe(false)
    expect(existsSync(fixture.paths.repositoriesFile)).toBe(false)
    expect(existsSync(fixture.paths.workflowsDirectory)).toBe(false)
  })

  it('rejects a source-to-export count mismatch before installation', async () => {
    const fixture = await createFixture()

    await expect(
      createLegacyMigrationInstaller({
        paths: fixture.paths,
        preparation: fixture.preparation,
        expected: { ...expected, repositories: 2 },
      }).install(),
    ).rejects.toMatchObject({ code: 'INVALID_EXPORT' })
    expect(existsSync(fixture.paths.settingsFile)).toBe(false)
    expect(existsSync(fixture.paths.repositoriesFile)).toBe(false)
    expect(existsSync(fixture.paths.workflowsDirectory)).toBe(false)
  })

  it('installs an empty workflows directory for a valid empty workflow catalog', async () => {
    const fixture = await createFixture(false)

    const manifest = await createLegacyMigrationInstaller({
      paths: fixture.paths,
      preparation: fixture.preparation,
      expected: { ...expected, workflows: 0 },
    }).install()

    expect(manifest.state).toBe('INSTALLED')
    expect(existsSync(fixture.paths.workflowsDirectory)).toBe(true)
    await expect(createFilesystemWorkflowStore({ paths: fixture.paths }).list()).resolves.toEqual(
      [],
    )
  })

  it('resumes safely after interruption between atomic target installs', async () => {
    const fixture = await createFixture()
    let installed = 0
    const interrupted = createLegacyMigrationInstaller({
      paths: fixture.paths,
      preparation: fixture.preparation,
      expected,
      afterTargetInstalled: () => {
        installed += 1
        if (installed === 1) throw new Error('simulated interruption')
      },
    })

    await expect(interrupted.install()).rejects.toThrow('simulated interruption')
    expect(existsSync(fixture.paths.settingsFile)).toBe(true)

    const manifest = await createLegacyMigrationInstaller({
      paths: fixture.paths,
      preparation: fixture.preparation,
      expected,
    }).install()

    expect(manifest.state).toBe('INSTALLED')
    expect(existsSync(fixture.paths.repositoriesFile)).toBe(true)
    expect(existsSync(fixture.paths.workflowsDirectory)).toBe(true)
  })

  it('rolls back only unchanged installed targets and retains recovery sources', async () => {
    const fixture = await createFixture()
    const installer = createLegacyMigrationInstaller({
      paths: fixture.paths,
      preparation: fixture.preparation,
      expected,
    })
    await installer.install()

    const manifest = await installer.rollback()

    expect(manifest.state).toBe('ROLLED_BACK')
    expect(existsSync(fixture.paths.settingsFile)).toBe(false)
    expect(existsSync(fixture.paths.repositoriesFile)).toBe(false)
    expect(existsSync(fixture.paths.workflowsDirectory)).toBe(false)
    expect(existsSync(fixture.databasePath)).toBe(true)
    expect(existsSync(fixture.preparation.backupPath)).toBe(true)
    expect(existsSync(fixture.preparation.exportDirectory)).toBe(true)
  })
})
