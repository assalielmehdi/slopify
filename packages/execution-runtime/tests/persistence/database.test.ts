import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DatabaseInitializationError,
  openDatabase,
  type WorkbenchDatabase,
} from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'

const EXPECTED_TABLES = [
  'artifacts',
  'node_executions',
  'output_chunks',
  'profile_snapshot_repositories',
  'project_profile_repositories',
  'project_profile_snapshots',
  'project_profiles',
  'repository_delivery_evidence',
  'run_events',
  'run_repository_selection_snapshots',
  'run_repository_selections',
  'run_workspaces',
  'runs',
  'schema_migrations',
  'workflow_revisions',
  'workflows',
] as const

const openedDatabases: WorkbenchDatabase[] = []
const temporaryDirectories: string[] = []

const createDatabasePath = (suffix = 'state/workbench.sqlite'): string => {
  const directory = join(tmpdir(), `slopify-database-${crypto.randomUUID()}`)
  temporaryDirectories.push(directory)
  return join(directory, suffix)
}

afterEach(() => {
  for (const database of openedDatabases.splice(0)) {
    if (database.isOpen) database.close()
  }

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('database connection', () => {
  it('creates the configured file and enables the required SQLite settings', () => {
    const databasePath = createDatabasePath()
    const database = openDatabase({ path: databasePath })
    openedDatabases.push(database)

    expect(database.path).toBe(databasePath)
    expect(database.isOpen).toBe(true)
    expect(existsSync(databasePath)).toBe(true)
    expect(database.status()).toEqual({
      foreignKeysEnabled: true,
      journalMode: 'wal',
      schemaVersion: 3,
      writable: true,
    })
  })

  it.each(['', '   ', ':memory:'])('rejects a non-file database path %j', (path) => {
    expect(() => openDatabase({ path })).toThrowError(
      expect.objectContaining({
        code: 'DATABASE_PATH_INVALID',
        databasePath: path,
      }),
    )
  })

  it('maps an unavailable database path to a stable structured error', () => {
    const parentFile = createDatabasePath('not-a-directory')
    mkdirSync(join(parentFile, '..'), { recursive: true })
    writeFileSync(parentFile, 'occupied')
    const databasePath = join(parentFile, 'workbench.sqlite')

    expect(() => openDatabase({ path: databasePath })).toThrowError(
      expect.objectContaining({
        code: 'DATABASE_OPEN_FAILED',
        databasePath,
      }),
    )

    try {
      openDatabase({ path: databasePath })
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseInitializationError)
    }
  })

  it('creates every durable record table without secret-bearing columns', () => {
    const database = openDatabase({ path: createDatabasePath() })
    openedDatabases.push(database)
    const connection = getDatabaseHandle(database)

    const tables = connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .pluck()
      .all() as string[]

    expect(tables).toEqual(EXPECTED_TABLES)

    const secretBearingColumns = tables.flatMap((table) => {
      const columns = connection.pragma(`table_info(${table})`) as { name: string }[]
      return columns
        .map(({ name }) => `${table}.${name}`)
        .filter((name) => /(?:token|secret|credential|password|api_key|private_key)/i.test(name))
    })

    expect(secretBearingColumns).toEqual([])
  })

  it('enforces immutable snapshots, run-scoped foreign keys, and profile ordering', () => {
    const database = openDatabase({ path: createDatabasePath() })
    openedDatabases.push(database)
    const connection = getDatabaseHandle(database)
    const timestamp = '2026-08-18T20:00:00Z'

    connection.exec(`
      INSERT INTO workflows (workflow_id, name, created_at)
      VALUES ('delivery-workflow', 'Delivery workflow', '${timestamp}');

      INSERT INTO workflow_revisions (
        workflow_id, revision_id, name, definition_json, created_at
      ) VALUES (
        'delivery-workflow', 'revision-01', 'Revision 1', '{}', '${timestamp}'
      );

      INSERT INTO project_profiles (
        profile_id, display_name, clickup_workspace_id, clickup_list_id,
        clickup_in_review_status_id, created_at, updated_at
      ) VALUES (
        'profile-01', 'Local profile', 'workspace-01', 'list-01',
        'in-review', '${timestamp}', '${timestamp}'
      );

      INSERT INTO project_profile_snapshots (
        snapshot_id, profile_id, display_name, clickup_workspace_id,
        clickup_list_id, clickup_in_review_status_id, created_at
      ) VALUES (
        'snapshot-01', 'profile-01', 'Local profile', 'workspace-01',
        'list-01', 'in-review', '${timestamp}'
      );

      INSERT INTO profile_snapshot_repositories (
        snapshot_id, repository_id, profile_position, display_name, purpose,
        repository_path, gitlab_project, remote, target_branch, worktree_parent,
        branch_template, executable_checks_json, verification_commands_json,
        merge_request_labels_json
      ) VALUES
        ('snapshot-01', 'api', 0, 'API', 'Backend', '/workspace/api',
         'group/api', 'origin', 'main', '/worktrees', 'ai/{task}-{run}', '[]', '[]', '[]'),
        ('snapshot-01', 'web', 1, 'Web', 'Frontend', '/workspace/web',
         'group/web', 'origin', 'main', '/worktrees', 'ai/{task}-{run}', '[]', '[]', '[]');

      INSERT INTO runs (
        run_id, workflow_id, revision_id, profile_snapshot_id, task_reference,
        task_snapshot_json, effective_configuration_json, status, created_at
      ) VALUES (
        'run-01', 'delivery-workflow', 'revision-01', 'snapshot-01', 'TASK-1',
        '{}', '{}', 'PENDING', '${timestamp}'
      );

      INSERT INTO run_repository_selections (
        run_id, profile_snapshot_id, repository_id, profile_position,
        responsibility, selected_at
      ) VALUES
        ('run-01', 'snapshot-01', 'api', 0, 'API changes', '${timestamp}'),
        ('run-01', 'snapshot-01', 'web', 1, 'UI changes', '${timestamp}');

      INSERT INTO run_workspaces (
        run_id, repository_id, repository_path, worktree_path, remote,
        target_branch, source_branch, base_sha, created_at
      ) VALUES (
        'run-01', 'api', '/workspace/api', '/worktrees/run-01-api', 'origin',
        'main', 'ai/task-1-run-01', '0123456789abcdef', '${timestamp}'
      );

      INSERT INTO node_executions (
        node_execution_id, run_id, node_id, execution_index, status,
        input_references_json, started_at
      ) VALUES (
        'node-execution-01', 'run-01', 'load-task', 1, 'RUNNING', '[]', '${timestamp}'
      );

      INSERT INTO run_events (
        run_id, sequence, event_type, node_execution_id, node_id, data_json, created_at
      ) VALUES (
        'run-01', 1, 'NODE_STARTED', 'node-execution-01', 'load-task', '{}', '${timestamp}'
      );

      INSERT INTO output_chunks (
        run_id, sequence, event_sequence, node_execution_id, channel, content, created_at
      ) VALUES (
        'run-01', 1, 1, 'node-execution-01', 'agent', 'Loading task', '${timestamp}'
      );

      INSERT INTO artifacts (
        artifact_id, run_id, node_execution_id, artifact_type, content,
        metadata_json, created_at
      ) VALUES (
        'artifact-01', 'run-01', 'node-execution-01', 'EXECUTION_PLAN',
        '# Plan', '{}', '${timestamp}'
      );

      INSERT INTO repository_delivery_evidence (
        run_id, repository_id, status, evidence_json, updated_at
      ) VALUES (
        'run-01', 'api', 'PENDING', '{}', '${timestamp}'
      );
    `)

    const selectedRepositories = connection
      .prepare(
        `SELECT repository_id
         FROM run_repository_selections
         WHERE run_id = ?
         ORDER BY profile_position`,
      )
      .pluck()
      .all('run-01')

    expect(selectedRepositories).toEqual(['api', 'web'])
    expect(() =>
      connection
        .prepare('UPDATE workflow_revisions SET definition_json = ? WHERE revision_id = ?')
        .run('{"changed":true}', 'revision-01'),
    ).toThrow(/immutable/i)
    expect(() =>
      connection
        .prepare('UPDATE project_profile_snapshots SET display_name = ? WHERE snapshot_id = ?')
        .run('Changed', 'snapshot-01'),
    ).toThrow(/immutable/i)
    expect(() =>
      connection
        .prepare(
          `INSERT INTO run_workspaces (
             run_id, repository_id, repository_path, worktree_path, remote,
             target_branch, source_branch, base_sha, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'run-01',
          'not-selected',
          '/workspace/other',
          '/worktrees/other',
          'origin',
          'main',
          'ai/other',
          'abcdef',
          timestamp,
        ),
    ).toThrow(/foreign key/i)
  })
})
