import { mkdirSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createFilesystemRepositoryStore,
  createFilesystemRunIndex,
  createFilesystemRunReader,
  createFilesystemWorkflowStore,
  createLegacyMigrationInstaller,
  loadLegacyMigrationPreparation,
  resolveSlopifyPaths,
} from '@slopify/execution-runtime'
import {
  TEST_RUN_ID,
  TEST_RUN_REPOSITORY,
  TEST_TIMESTAMP,
  createPersistenceFixture,
  createRun,
  createTestAgentWorkflow,
  insertLegacyRepository,
} from '../../../packages/execution-runtime/tests/persistence/test-fixture.js'
import { prepareFilesystemStartup } from '../src/startup-state.js'
import { startConfiguredApiServer } from '../src/server.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const createLegacyFixture = async () => {
  const root = join(tmpdir(), `slopify-startup-migration-${crypto.randomUUID()}`)
  roots.push(root)
  mkdirSync(root, { recursive: true })
  const workflow = createTestAgentWorkflow({
    repositoryIds: [TEST_RUN_REPOSITORY.repositoryId],
    primaryRepositoryId: TEST_RUN_REPOSITORY.repositoryId,
  })
  const fixture = createPersistenceFixture(workflow)
  roots.push(dirname(dirname(fixture.path)))
  insertLegacyRepository(fixture.database, {
    repositoryId: TEST_RUN_REPOSITORY.repositoryId,
    name: TEST_RUN_REPOSITORY.name,
    provider: TEST_RUN_REPOSITORY.provider,
    remoteId: TEST_RUN_REPOSITORY.remoteId,
    fullName: TEST_RUN_REPOSITORY.fullName,
    cloneUrl: TEST_RUN_REPOSITORY.cloneUrl,
    webUrl: 'https://github.com/operator/api',
    defaultBranch: TEST_RUN_REPOSITORY.defaultBranch,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
  })
  createRun(fixture)
  const connection = fixture.database
  connection
    .prepare(
      `UPDATE runs SET status = 'SUCCEEDED', started_at = ?, completed_at = ?
       WHERE run_id = ?`,
    )
    .run('2026-08-23T12:00:01.000Z', '2026-08-23T12:00:03.000Z', TEST_RUN_ID)
  connection
    .prepare(
      `INSERT INTO node_executions (
         node_execution_id, run_id, node_id, execution_index, attempt_id, status,
         output_json, outcome, started_at, completed_at, duration_ms
       ) VALUES (?, ?, ?, ?, ?, 'SUCCEEDED', json(?), ?, ?, ?, ?)`,
    )
    .run(
      'execution-startup-01',
      TEST_RUN_ID,
      'agent',
      1,
      'attempt-startup-01',
      JSON.stringify({ summary: 'Migrated at startup.' }),
      'completed',
      '2026-08-23T12:00:01.000Z',
      '2026-08-23T12:00:03.000Z',
      2_000,
    )
  fixture.database.close()
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: join(root, 'home') } })
  return { fixture, paths, root, workflow }
}

describe('filesystem startup preparation', () => {
  it('leaves a clean home database-free', async () => {
    const root = join(tmpdir(), `slopify-clean-startup-${crypto.randomUUID()}`)
    roots.push(root)
    const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: join(root, 'home') } })
    const databasePath = join(paths.home, 'slopify.db')

    const result = await prepareFilesystemStartup({
      paths,
      databasePath,
      legacyTracesRoot: join(paths.home, 'traces'),
    })

    expect(result).toEqual({ state: 'CLEAN' })
    await expect(Bun.file(databasePath).exists()).resolves.toBe(false)
  })

  it('migrates a legacy-only home before exposing final filesystem readers', async () => {
    const { fixture, paths, root, workflow } = await createLegacyFixture()

    const result = await prepareFilesystemStartup({
      paths,
      databasePath: fixture.path,
      legacyTracesRoot: join(root, 'legacy-traces'),
      now: () => '2026-08-25T12:00:00.000Z',
    })

    expect(result).toMatchObject({
      state: 'MIGRATED',
      counts: { repositories: 1, workflows: 1, runs: 1, nodes: 1, traces: 0 },
    })
    await expect(createFilesystemRepositoryStore({ paths }).list()).resolves.toHaveLength(1)
    await expect(
      createFilesystemWorkflowStore({ paths }).get(workflow.workflowId),
    ).resolves.toMatchObject({ status: 'VALID' })
    const index = createFilesystemRunIndex({ paths })
    await expect(
      createFilesystemRunReader({ index, paths }).get(TEST_RUN_ID),
    ).resolves.toMatchObject({
      status: 'READY',
      run: { status: 'SUCCEEDED' },
      executions: [{ status: 'SUCCEEDED', output: { summary: 'Migrated at startup.' } }],
    })

    let fetchHandler:
      | ((
          request: Request,
          server: Pick<Bun.Server<unknown>, 'timeout'>,
        ) => Response | Promise<Response>)
      | undefined
    const server = await startConfiguredApiServer(
      {
        SLOPIFY_HOME: paths.home,
      },
      {
        serve(options) {
          fetchHandler = options.fetch
          return { hostname: options.hostname, port: options.port, stop: async () => undefined }
        },
        registerSignals: () => () => undefined,
        pollIntervalMs: 1_000,
      },
    )
    const response = await fetchHandler?.(new Request(`http://localhost/api/runs/${TEST_RUN_ID}`), {
      timeout: () => undefined,
    } as Pick<Bun.Server<unknown>, 'timeout'>)
    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toMatchObject({
      run: { status: 'SUCCEEDED' },
      executions: [{ output: { summary: 'Migrated at startup.' } }],
    })
    await server.stop()
  })

  it('does not consult a legacy database after a completed installation', async () => {
    const { fixture, paths, root } = await createLegacyFixture()
    const input = {
      paths,
      databasePath: fixture.path,
      legacyTracesRoot: join(root, 'legacy-traces'),
    }
    const migrated = await prepareFilesystemStartup(input)
    expect(migrated.state).toBe('MIGRATED')
    await writeFile(fixture.path, 'not a SQLite database')

    await expect(prepareFilesystemStartup(input)).resolves.toMatchObject({ state: 'READY' })
  })

  it('fails closed after an explicit rollback while recovery sources remain', async () => {
    const { fixture, paths, root } = await createLegacyFixture()
    const input = {
      paths,
      databasePath: fixture.path,
      legacyTracesRoot: join(root, 'legacy-traces'),
    }
    const migrated = await prepareFilesystemStartup(input)
    if (migrated.state !== 'MIGRATED') throw new Error('Expected migration')
    const preparation = await loadLegacyMigrationPreparation({
      paths,
      migrationId: 'sqlite-filesystem-v1',
    })
    if (preparation === undefined) throw new Error('Expected migration preparation')
    await createLegacyMigrationInstaller({
      paths,
      preparation,
      expected: migrated.counts,
    }).rollback()

    await expect(prepareFilesystemStartup(input)).rejects.toMatchObject({
      code: 'MIGRATION_ROLLED_BACK',
    })
    await expect(Bun.file(fixture.path).exists()).resolves.toBe(true)
    await expect(Bun.file(preparation.backupPath).exists()).resolves.toBe(true)
  })
})
