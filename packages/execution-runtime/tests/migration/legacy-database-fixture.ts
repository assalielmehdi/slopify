import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { Database } from '../../src/migration/legacy-sqlite.js'

export const createLegacyTestDatabase = (path: string): Database => {
  mkdirSync(dirname(path), { recursive: true })
  const database = new Database(path)
  database.exec(`
    PRAGMA application_id = 1397510233;
    CREATE TABLE schema_metadata (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
    INSERT INTO schema_metadata VALUES (4, 'current_schema', '2026-08-23T12:00:00.000Z');
    CREATE TABLE deletion_operations (deletion_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE workflows (
      workflow_id TEXT PRIMARY KEY, definition_json TEXT NOT NULL,
      deletion_id TEXT, deleted_at TEXT
    ) STRICT;
    CREATE TABLE git_connections (
      provider TEXT PRIMARY KEY, account_username TEXT NOT NULL,
      connected_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE repositories (
      repository_id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL,
      remote_id TEXT NOT NULL, repository_full_name TEXT NOT NULL, clone_url TEXT NOT NULL,
      web_url TEXT NOT NULL, default_branch TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, deletion_id TEXT, deleted_at TEXT
    ) STRICT;
    CREATE TABLE runs (
      run_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, variables_json TEXT NOT NULL,
      workflow_snapshot_json TEXT NOT NULL, status TEXT NOT NULL,
      transition_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      started_at TEXT, completed_at TEXT
    ) STRICT;
    CREATE TABLE run_repositories (
      run_id TEXT NOT NULL, repository_id TEXT NOT NULL, repository_position INTEGER NOT NULL,
      name TEXT NOT NULL, provider TEXT, remote_id TEXT, repository_full_name TEXT NOT NULL,
      clone_url TEXT NOT NULL, default_branch TEXT, base_sha TEXT NOT NULL,
      is_primary INTEGER NOT NULL, PRIMARY KEY (run_id, repository_id)
    ) STRICT;
    CREATE TABLE run_repository_workspaces (
      run_id TEXT NOT NULL, repository_id TEXT NOT NULL, status TEXT NOT NULL,
      workspace_path TEXT NOT NULL, branch_name TEXT, error_message TEXT, prepared_at TEXT,
      cleaned_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (run_id, repository_id)
    ) STRICT;
    CREATE TABLE node_executions (
      node_execution_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, node_id TEXT NOT NULL,
      execution_index INTEGER NOT NULL, attempt_id TEXT NOT NULL, status TEXT NOT NULL,
      output_json TEXT, outcome TEXT, error_code TEXT, error_message TEXT, started_at TEXT,
      completed_at TEXT, duration_ms INTEGER
    ) STRICT;
    CREATE TABLE run_events (
      run_id TEXT NOT NULL, sequence INTEGER NOT NULL, event_type TEXT NOT NULL,
      node_execution_id TEXT, node_id TEXT, data_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, sequence)
    ) STRICT;
  `)
  return database
}

export type LegacyTestDatabase = Database

export const openLegacyTestDatabase = (path: string): Database => new Database(path)
