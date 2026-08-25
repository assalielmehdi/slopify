import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  LegacyMigrationError,
  createLegacyMigrationService,
  openDatabase,
  resolveSlopifyPaths,
} from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'

const roots: string[] = []

const createRoot = (): string => {
  const root = join(tmpdir(), `slopify-migration-${crypto.randomUUID()}`)
  roots.push(root)
  mkdirSync(root, { recursive: true })
  return root
}

const createLegacyDatabase = (root: string): string => {
  const path = join(root, 'legacy.sqlite')
  openDatabase({ path }).close()
  return path
}

const createService = (root: string, databasePath = createLegacyDatabase(root)) =>
  createLegacyMigrationService({
    databasePath,
    paths: resolveSlopifyPaths({ environment: { SLOPIFY_HOME: join(root, 'home') } }),
    createMigrationId: () => 'sqlite-v4-test',
    now: () => '2026-08-25T12:00:00.000Z',
  })

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('legacy SQLite migration preflight', () => {
  it('copies an unchanged database and records matching hashes before conversion', async () => {
    const root = createRoot()
    const databasePath = createLegacyDatabase(root)
    const sourceBefore = readFileSync(databasePath)

    const prepared = await createService(root, databasePath).prepare()

    expect(readFileSync(databasePath)).toEqual(sourceBefore)
    expect(readFileSync(prepared.backupPath)).toEqual(sourceBefore)
    expect(prepared.exportDirectory).toBe(join(prepared.directory, 'export'))
    expect(prepared.manifest).toMatchObject({
      schemaVersion: 1,
      migrationId: 'sqlite-v4-test',
      state: 'BACKED_UP',
      createdAt: '2026-08-25T12:00:00.000Z',
      legacySchemaVersion: 4,
      source: { path: databasePath, sizeBytes: sourceBefore.byteLength },
      backup: { path: prepared.backupPath, sizeBytes: sourceBefore.byteLength },
    })
    expect(prepared.manifest.source.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(prepared.manifest.backup.sha256).toBe(prepared.manifest.source.sha256)
    expect(JSON.parse(readFileSync(prepared.manifestPath, 'utf8'))).toEqual(prepared.manifest)
  }, 15_000)

  it.each(['PENDING', 'RUNNING'] as const)(
    'refuses a %s legacy run without a backup',
    async (status) => {
      const root = createRoot()
      const databasePath = createLegacyDatabase(root)
      const database = openDatabase({ path: databasePath })
      const connection = getDatabaseHandle(database)
      connection
        .prepare(
          `INSERT INTO workflows (workflow_id, definition_json)
         VALUES (?, json(?))`,
        )
        .run('workflow-active', '{}')
      connection
        .prepare(
          `INSERT INTO runs (
           run_id, workflow_id, variables_json, workflow_snapshot_json,
           status, created_at
         ) VALUES (?, ?, json(?), json(?), ?, ?)`,
        )
        .run(
          `run-${status.toLowerCase()}`,
          'workflow-active',
          '{}',
          '{}',
          status,
          '2026-08-25T11:00:00.000Z',
        )
      database.close()

      await expect(createService(root, databasePath).prepare()).rejects.toMatchObject({
        code: 'ACTIVE_RUNS',
      } satisfies Partial<LegacyMigrationError>)
      expect(() =>
        readFileSync(join(root, 'home', 'migrations', 'sqlite-v4-test', 'slopify.db')),
      ).toThrow()
    },
  )

  it.each(['settings.json', 'repositories.json', 'workflows/workflow-existing/workflow.json'])(
    'refuses the existing target %s without overwriting it',
    async (relativeTarget) => {
      const root = createRoot()
      const service = createService(root)
      const target = join(root, 'home', relativeTarget)
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, 'existing')

      await expect(service.prepare()).rejects.toMatchObject({ code: 'TARGET_CONFLICT' })
      expect(readFileSync(target, 'utf8')).toBe('existing')
      expect(() =>
        readFileSync(join(root, 'home', 'migrations', 'sqlite-v4-test', 'slopify.db')),
      ).toThrow()
    },
  )

  it('refuses a corrupt or foreign database without creating a backup', async () => {
    const root = createRoot()
    const databasePath = join(root, 'legacy.sqlite')
    writeFileSync(databasePath, 'not sqlite')

    await expect(createService(root, databasePath).prepare()).rejects.toMatchObject({
      code: 'INVALID_DATABASE',
    })
    expect(() =>
      readFileSync(join(root, 'home', 'migrations', 'sqlite-v4-test', 'slopify.db')),
    ).toThrow()
  })

  it('backs up and hashes uncheckpointed WAL data without changing the source', async () => {
    const root = createRoot()
    const databasePath = join(root, 'legacy.sqlite')
    const database = openDatabase({ path: databasePath })
    getDatabaseHandle(database)
      .prepare(
        `INSERT INTO git_connections (
           provider, account_username, connected_at, updated_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .run('GITHUB', 'operator', '2026-08-25T11:00:00.000Z', '2026-08-25T11:00:00.000Z')

    try {
      const preparation = await createService(root, databasePath).prepare()
      expect(preparation.manifest.sidecars.map(({ kind }) => kind)).toEqual(['WAL', 'SHM'])
      for (const sidecar of preparation.manifest.sidecars) {
        expect(readFileSync(sidecar.backup.path)).toEqual(readFileSync(sidecar.source.path))
        expect(sidecar.backup.sha256).toBe(sidecar.source.sha256)
      }
    } finally {
      database.close()
    }
  })
})
