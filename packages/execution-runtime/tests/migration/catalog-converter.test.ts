import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createFilesystemRepositoryStore,
  createFilesystemSettingsStore,
  createFilesystemWorkflowStore,
  createLegacyCatalogConverter,
  createLegacyMigrationService,
  openDatabase,
  resolveSlopifyPaths,
} from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'

const roots: string[] = []

const legacyWorkflow = {
  schemaVersion: 1,
  workflowId: 'release-review',
  name: 'Release review',
  description: 'Review and approve a release.',
  configuration: {
    projectIds: ['repository-api'],
    primaryProjectId: 'repository-api',
    variables: ['release'],
  },
  startNodeId: 'review',
  nodes: [
    {
      type: 'agent',
      id: 'review',
      name: 'Review',
      prompt: 'Review {{ release }}.',
      harness: { harnessId: 'pi' },
    },
  ],
  edges: [],
  maxTransitions: 0,
  createdAt: '2026-08-20T12:00:00.000Z',
  updatedAt: '2026-08-21T12:00:00.000Z',
} as const

const createFixture = async (workflowDefinition: unknown = legacyWorkflow) => {
  const root = join(tmpdir(), `slopify-catalog-migration-${crypto.randomUUID()}`)
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
  connection
    .prepare('INSERT INTO workflows (workflow_id, definition_json) VALUES (?, json(?))')
    .run(legacyWorkflow.workflowId, JSON.stringify(workflowDefinition))
  database.close()

  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: join(root, 'home') } })
  const preparation = await createLegacyMigrationService({
    databasePath,
    paths,
    createMigrationId: () => 'sqlite-v4-catalog',
    now: () => '2026-08-25T12:00:00.000Z',
  }).prepare()
  return { preparation }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('legacy catalog converter', () => {
  it('exports validated settings, repositories, and v2 workflow files without PAT bytes', async () => {
    const { preparation } = await createFixture()

    const result = await createLegacyCatalogConverter({ preparation }).convert()

    expect(result).toEqual({ connections: 1, repositories: 1, workflows: 1 })
    const exportPaths = resolveSlopifyPaths({
      environment: { SLOPIFY_HOME: preparation.exportDirectory },
    })
    await expect(
      createFilesystemSettingsStore({ paths: exportPaths }).read(),
    ).resolves.toMatchObject({
      value: {
        schemaVersion: 1,
        appearance: { theme: 'system' },
        git: {
          connections: [
            {
              provider: 'GITHUB',
              accountUsername: 'operator',
              connectedAt: '2026-08-20T10:00:00.000Z',
              updatedAt: '2026-08-21T10:00:00.000Z',
              credentialReference: 'credential://dev.slopify.git/github.com',
            },
          ],
        },
      },
    })
    await expect(createFilesystemRepositoryStore({ paths: exportPaths }).list()).resolves.toEqual([
      expect.objectContaining({ repositoryId: 'repository-api', fullName: 'operator/api' }),
    ])
    await expect(createFilesystemWorkflowStore({ paths: exportPaths }).list()).resolves.toEqual([
      expect.objectContaining({
        status: 'VALID',
        value: expect.objectContaining({
          schemaVersion: 2,
          workflowId: 'release-review',
          repositories: {
            repositoryIds: ['repository-api'],
            primaryRepositoryId: 'repository-api',
          },
          variables: ['release'],
        }),
      }),
    ])
    expect(readFileSync(exportPaths.settingsFile, 'utf8')).not.toMatch(/token|pat/i)
  })

  it('produces byte-stable editable resources across independent dry runs', async () => {
    const first = await createFixture()
    const second = await createFixture()
    await createLegacyCatalogConverter({ preparation: first.preparation }).convert()
    await createLegacyCatalogConverter({ preparation: second.preparation }).convert()

    const readExport = (preparation: typeof first.preparation) => {
      const paths = resolveSlopifyPaths({
        environment: { SLOPIFY_HOME: preparation.exportDirectory },
      })
      return [
        readFileSync(paths.settingsFile, 'utf8'),
        readFileSync(paths.repositoriesFile, 'utf8'),
        readFileSync(paths.workflow('release-review').definitionFile, 'utf8'),
      ]
    }
    expect(readExport(first.preparation)).toEqual(readExport(second.preparation))
  })

  it('validates the complete catalog before writing any export resource', async () => {
    const fixture = await createFixture({
      ...legacyWorkflow,
      configuration: {
        ...legacyWorkflow.configuration,
        projectIds: ['repository-missing'],
        primaryProjectId: 'repository-missing',
      },
    })

    await expect(
      createLegacyCatalogConverter({ preparation: fixture.preparation }).convert(),
    ).rejects.toMatchObject({ code: 'INVALID_DATABASE' })
    const exportPaths = resolveSlopifyPaths({
      environment: { SLOPIFY_HOME: fixture.preparation.exportDirectory },
    })
    expect(existsSync(exportPaths.settingsFile)).toBe(false)
    expect(existsSync(exportPaths.repositoriesFile)).toBe(false)
    expect(existsSync(exportPaths.workflowsDirectory)).toBe(false)
  })
})
