import type { Database } from './sqlite.js'

export const SLOPIFY_DATABASE_APPLICATION_ID = 0x534c5059
export const CURRENT_SCHEMA_MARKER = Object.freeze({ version: 4, name: 'current_schema' })

const CURRENT_TABLES = Object.freeze([
  'deletion_operations',
  'execution_messages',
  'git_connections',
  'node_executions',
  'repositories',
  'run_events',
  'run_repositories',
  'run_repository_workspaces',
  'runs',
  'schema_metadata',
  'workflow_coordinator_states',
  'workflows',
])

const VERSION_ONE_TABLES = Object.freeze([
  'deletion_operations',
  'execution_messages',
  'node_executions',
  'projects',
  'run_events',
  'run_project_worktrees',
  'run_projects',
  'runs',
  'schema_metadata',
  'workflow_coordinator_states',
  'workflows',
])

const VERSION_TWO_TABLES = Object.freeze([
  'deletion_operations',
  'execution_messages',
  'git_connections',
  'node_executions',
  'projects',
  'run_events',
  'run_project_workspaces',
  'run_projects',
  'runs',
  'schema_metadata',
  'workflow_coordinator_states',
  'workflows',
])

const VERSION_THREE_TABLES = CURRENT_TABLES

const CURRENT_SCHEMA = `
  CREATE TABLE schema_metadata (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE workflows (
    workflow_id TEXT PRIMARY KEY,
    definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
    deletion_id TEXT REFERENCES deletion_operations (deletion_id),
    deleted_at TEXT
  ) STRICT;

  CREATE TABLE git_connections (
    provider TEXT PRIMARY KEY CHECK (provider IN ('GITHUB', 'GITLAB')),
    account_username TEXT NOT NULL,
    connected_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE deletion_operations (
    deletion_id TEXT PRIMARY KEY,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('REPOSITORY', 'WORKFLOW')),
    subject_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('PENDING', 'UNDONE', 'PURGED')),
    deleted_at TEXT NOT NULL,
    undo_expires_at TEXT NOT NULL,
    restored_at TEXT,
    purged_at TEXT
  ) STRICT;

  CREATE UNIQUE INDEX deletion_operations_pending_subject
    ON deletion_operations (subject_type, subject_id)
    WHERE state = 'PENDING';

  CREATE INDEX workflows_by_deletion_id ON workflows (deletion_id);

  CREATE TABLE repositories (
    repository_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('GITHUB', 'GITLAB')),
    remote_id TEXT NOT NULL,
    repository_full_name TEXT NOT NULL,
    clone_url TEXT NOT NULL,
    web_url TEXT NOT NULL,
    default_branch TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deletion_id TEXT REFERENCES deletion_operations (deletion_id),
    deleted_at TEXT,
    UNIQUE (provider, remote_id)
  ) STRICT;

  CREATE INDEX repositories_by_deletion_id ON repositories (deletion_id);

  CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    variables_json TEXT NOT NULL CHECK (json_valid(variables_json)),
    workflow_snapshot_json TEXT NOT NULL CHECK (json_valid(workflow_snapshot_json)),
    status TEXT NOT NULL CHECK (
      status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
    ),
    transition_count INTEGER NOT NULL DEFAULT 0 CHECK (transition_count >= 0),
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (workflow_id) REFERENCES workflows (workflow_id)
  ) STRICT;

  CREATE INDEX runs_by_created_at ON runs (created_at DESC, run_id DESC);

  CREATE TABLE run_repositories (
    run_id TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    repository_position INTEGER NOT NULL CHECK (repository_position >= 0),
    name TEXT NOT NULL,
    provider TEXT CHECK (provider IS NULL OR provider IN ('GITHUB', 'GITLAB')),
    remote_id TEXT,
    repository_full_name TEXT NOT NULL,
    clone_url TEXT NOT NULL,
    default_branch TEXT,
    base_sha TEXT NOT NULL CHECK (
      base_sha NOT GLOB '*[^0-9a-f]*'
      AND length(base_sha) IN (40, 64)
    ),
    is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
    PRIMARY KEY (run_id, repository_id),
    UNIQUE (run_id, repository_position),
    UNIQUE (run_id, provider, remote_id),
    FOREIGN KEY (run_id) REFERENCES runs (run_id),
    CHECK (
      (provider IS NULL AND remote_id IS NULL)
      OR (provider IS NOT NULL AND remote_id IS NOT NULL AND default_branch IS NOT NULL)
    )
  ) STRICT;

  CREATE UNIQUE INDEX run_repositories_one_primary
    ON run_repositories (run_id)
    WHERE is_primary = 1;

  CREATE TABLE run_repository_workspaces (
    run_id TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PREPARING', 'READY', 'FAILED', 'CLEANED', 'LEGACY')),
    workspace_path TEXT NOT NULL UNIQUE,
    branch_name TEXT,
    error_message TEXT,
    prepared_at TEXT,
    cleaned_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, repository_id),
    FOREIGN KEY (run_id, repository_id) REFERENCES run_repositories (run_id, repository_id),
    CHECK (
      (status = 'PREPARING' AND branch_name IS NOT NULL AND error_message IS NULL AND prepared_at IS NULL AND cleaned_at IS NULL)
      OR (status = 'READY' AND branch_name IS NOT NULL AND error_message IS NULL AND prepared_at IS NOT NULL AND cleaned_at IS NULL)
      OR (status = 'FAILED' AND branch_name IS NOT NULL AND error_message IS NOT NULL AND prepared_at IS NULL AND cleaned_at IS NULL)
      OR (status = 'CLEANED' AND branch_name IS NOT NULL AND error_message IS NULL AND cleaned_at IS NOT NULL)
      OR (status = 'LEGACY' AND branch_name IS NULL AND cleaned_at IS NULL)
    )
  ) STRICT;

  CREATE TABLE node_executions (
    node_execution_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    execution_index INTEGER NOT NULL CHECK (execution_index > 0),
    attempt_id TEXT NOT NULL CHECK (length(trim(attempt_id)) > 0),
    status TEXT NOT NULL CHECK (
      status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
    ),
    output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
    outcome TEXT,
    error_code TEXT,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    UNIQUE (run_id, node_execution_id),
    UNIQUE (run_id, execution_index),
    UNIQUE (run_id, attempt_id),
    FOREIGN KEY (run_id) REFERENCES runs (run_id)
  ) STRICT;

  CREATE INDEX node_executions_by_run ON node_executions (run_id, execution_index);

  CREATE TABLE run_events (
    run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    event_type TEXT NOT NULL CHECK (
      event_type IN (
        'RUN_STARTED', 'RUN_STATUS_CHANGED', 'NODE_STARTED',
        'NODE_COMPLETED', 'NODE_FAILED', 'NODE_CANCELLED',
        'RUN_CANCEL_REQUESTED', 'RUN_COMPLETED'
      )
    ),
    node_execution_id TEXT,
    node_id TEXT,
    data_json TEXT NOT NULL CHECK (json_valid(data_json)),
    created_at TEXT NOT NULL,
    PRIMARY KEY (run_id, sequence),
    FOREIGN KEY (run_id) REFERENCES runs (run_id),
    FOREIGN KEY (run_id, node_execution_id)
      REFERENCES node_executions (run_id, node_execution_id)
  ) STRICT;

  CREATE TABLE execution_messages (
    id TEXT PRIMARY KEY,
    destination TEXT NOT NULL CHECK (destination IN ('WORKER', 'COORDINATOR')),
    type TEXT NOT NULL CHECK (
      type IN (
        'EXECUTE_NODE', 'NODE_EXECUTION_STARTED', 'NODE_EXECUTION_SUCCEEDED',
        'NODE_EXECUTION_FAILED', 'NODE_EXECUTION_CANCELLED'
      )
    ),
    run_id TEXT NOT NULL,
    node_execution_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'CLAIMED', 'PROCESSED')),
    available_at TEXT NOT NULL,
    claimed_by TEXT,
    lease_expires_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at TEXT NOT NULL,
    processed_at TEXT,
    CHECK (
      (status = 'PENDING' AND claimed_by IS NULL AND lease_expires_at IS NULL)
      OR (status = 'CLAIMED' AND claimed_by IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR (status = 'PROCESSED')
    ),
    CHECK (
      (destination = 'WORKER' AND type = 'EXECUTE_NODE')
      OR (destination = 'COORDINATOR' AND type <> 'EXECUTE_NODE')
    ),
    FOREIGN KEY (run_id) REFERENCES runs (run_id)
  ) STRICT;

  CREATE INDEX execution_messages_by_destination_status_availability
    ON execution_messages (destination, status, available_at, lease_expires_at, id);

  CREATE INDEX execution_messages_by_run
    ON execution_messages (run_id, created_at, id);

  CREATE TABLE workflow_coordinator_states (
    run_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL CHECK (json_valid(state_json)),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs (run_id)
  ) STRICT;
`

interface SchemaMarkerRow {
  readonly version: number
  readonly name: string
}

const schemaMarkers = (database: Database): readonly SchemaMarkerRow[] =>
  database
    .prepare('SELECT version, name FROM schema_metadata ORDER BY version')
    .all() as SchemaMarkerRow[]

const hasMarker = (database: Database, version: number): boolean => {
  try {
    const markers = schemaMarkers(database)
    return (
      markers.length === 1 &&
      markers[0]?.version === version &&
      markers[0]?.name === 'current_schema'
    )
  } catch {
    return false
  }
}

export class DatabaseSchemaIncompatibleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseSchemaIncompatibleError'
  }
}

const listTables = (database: Database): readonly string[] =>
  database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .pluck()
    .all() as string[]

const isCurrentSchema = (database: Database, tables: readonly string[]): boolean => {
  if (
    tables.length !== CURRENT_TABLES.length ||
    tables.some((table, index) => table !== CURRENT_TABLES[index])
  ) {
    return false
  }
  try {
    return hasMarker(database, CURRENT_SCHEMA_MARKER.version)
  } catch {
    return false
  }
}

const isVersionOneSchema = (database: Database, tables: readonly string[]): boolean =>
  tables.length === VERSION_ONE_TABLES.length &&
  tables.every((table, index) => table === VERSION_ONE_TABLES[index]) &&
  hasMarker(database, 1)

const isVersionTwoSchema = (database: Database, tables: readonly string[]): boolean =>
  tables.length === VERSION_TWO_TABLES.length &&
  tables.every((table, index) => table === VERSION_TWO_TABLES[index]) &&
  hasMarker(database, 2)

const isVersionThreeSchema = (database: Database, tables: readonly string[]): boolean =>
  tables.length === VERSION_THREE_TABLES.length &&
  tables.every((table, index) => table === VERSION_THREE_TABLES[index]) &&
  hasMarker(database, 3)

const migrateVersionOne = (database: Database): void => {
  database.pragma('foreign_keys = OFF')
  try {
    database
      .transaction(() => {
        database.exec(`
          DROP INDEX projects_by_deletion_id;
          DROP INDEX run_projects_one_primary;
          ALTER TABLE projects RENAME TO projects_v1;
          ALTER TABLE run_projects RENAME TO run_projects_v1;
          ALTER TABLE run_project_worktrees RENAME TO run_project_worktrees_v1;

          CREATE TABLE git_connections (
            provider TEXT PRIMARY KEY CHECK (provider IN ('GITHUB', 'GITLAB')),
            account_username TEXT NOT NULL,
            connected_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;

          CREATE TABLE projects (
            project_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider TEXT NOT NULL CHECK (provider IN ('GITHUB', 'GITLAB')),
            remote_id TEXT NOT NULL,
            repository_full_name TEXT NOT NULL,
            clone_url TEXT NOT NULL,
            web_url TEXT NOT NULL,
            default_branch TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deletion_id TEXT REFERENCES deletion_operations (deletion_id),
            deleted_at TEXT,
            UNIQUE (provider, remote_id)
          ) STRICT;
          CREATE INDEX projects_by_deletion_id ON projects (deletion_id);

          CREATE TABLE run_projects (
            run_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            project_position INTEGER NOT NULL CHECK (project_position >= 0),
            name TEXT NOT NULL,
            provider TEXT CHECK (provider IS NULL OR provider IN ('GITHUB', 'GITLAB')),
            remote_id TEXT,
            repository_full_name TEXT NOT NULL,
            clone_url TEXT NOT NULL,
            default_branch TEXT,
            base_sha TEXT NOT NULL CHECK (
              base_sha NOT GLOB '*[^0-9a-f]*' AND length(base_sha) IN (40, 64)
            ),
            is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
            PRIMARY KEY (run_id, project_id),
            UNIQUE (run_id, project_position),
            UNIQUE (run_id, provider, remote_id),
            FOREIGN KEY (run_id) REFERENCES runs (run_id),
            CHECK (
              (provider IS NULL AND remote_id IS NULL)
              OR (provider IS NOT NULL AND remote_id IS NOT NULL AND default_branch IS NOT NULL)
            )
          ) STRICT;
          CREATE UNIQUE INDEX run_projects_one_primary
            ON run_projects (run_id) WHERE is_primary = 1;

          CREATE TABLE run_project_workspaces (
            run_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK (
              status IN ('PREPARING', 'READY', 'FAILED', 'CLEANED', 'LEGACY')
            ),
            workspace_path TEXT NOT NULL UNIQUE,
            branch_name TEXT,
            error_message TEXT,
            prepared_at TEXT,
            cleaned_at TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (run_id, project_id),
            FOREIGN KEY (run_id, project_id) REFERENCES run_projects (run_id, project_id),
            CHECK (
              (status = 'PREPARING' AND branch_name IS NOT NULL AND error_message IS NULL AND prepared_at IS NULL AND cleaned_at IS NULL)
              OR (status = 'READY' AND branch_name IS NOT NULL AND error_message IS NULL AND prepared_at IS NOT NULL AND cleaned_at IS NULL)
              OR (status = 'FAILED' AND branch_name IS NOT NULL AND error_message IS NOT NULL AND prepared_at IS NULL AND cleaned_at IS NULL)
              OR (status = 'CLEANED' AND branch_name IS NOT NULL AND error_message IS NULL AND cleaned_at IS NOT NULL)
              OR (status = 'LEGACY' AND branch_name IS NULL AND cleaned_at IS NULL)
            )
          ) STRICT;

          INSERT INTO run_projects (
            run_id, project_id, project_position, name, provider, remote_id,
            repository_full_name, clone_url, default_branch, base_sha, is_primary
          )
          SELECT run_id, project_id, project_position, name, NULL, NULL,
                 name, repository_path, source_branch, base_sha, is_primary
          FROM run_projects_v1;

          INSERT INTO run_project_workspaces (
            run_id, project_id, status, workspace_path, branch_name,
            error_message, prepared_at, cleaned_at, updated_at
          )
          SELECT run_id, project_id, 'LEGACY', worktree_path, NULL,
                 error_message, prepared_at, NULL, updated_at
          FROM run_project_worktrees_v1;

          DROP TABLE run_project_worktrees_v1;
          DROP TABLE run_projects_v1;
          DROP TABLE projects_v1;
          DELETE FROM deletion_operations;
          UPDATE schema_metadata
          SET version = 2, applied_at = '2026-08-24T00:00:00.000Z'
          WHERE version = 1 AND name = 'current_schema';
        `)
      })
      .immediate()
  } finally {
    database.pragma('foreign_keys = ON')
  }
}

const migrateVersionTwo = (database: Database): void => {
  database.pragma('foreign_keys = OFF')
  try {
    database
      .transaction(() => {
        database.exec(`
          DROP INDEX IF EXISTS deletion_operations_pending_subject;
          DROP INDEX IF EXISTS projects_by_deletion_id;
          DROP INDEX IF EXISTS run_projects_one_primary;

          ALTER TABLE deletion_operations RENAME TO deletion_operations_v2;
          ALTER TABLE projects RENAME TO projects_v2;
          ALTER TABLE run_projects RENAME TO run_repositories;
          ALTER TABLE run_repositories RENAME COLUMN project_id TO repository_id;
          ALTER TABLE run_repositories RENAME COLUMN project_position TO repository_position;
          ALTER TABLE run_project_workspaces RENAME TO run_repository_workspaces;
          ALTER TABLE run_repository_workspaces RENAME COLUMN project_id TO repository_id;

          CREATE TABLE deletion_operations (
            deletion_id TEXT PRIMARY KEY,
            subject_type TEXT NOT NULL CHECK (subject_type = 'REPOSITORY'),
            subject_id TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('PENDING', 'UNDONE', 'PURGED')),
            deleted_at TEXT NOT NULL,
            undo_expires_at TEXT NOT NULL,
            restored_at TEXT,
            purged_at TEXT
          ) STRICT;

          CREATE UNIQUE INDEX deletion_operations_pending_subject
            ON deletion_operations (subject_type, subject_id)
            WHERE state = 'PENDING';

          INSERT INTO deletion_operations (
            deletion_id, subject_type, subject_id, state, deleted_at,
            undo_expires_at, restored_at, purged_at
          )
          SELECT deletion_id, 'REPOSITORY', subject_id, state, deleted_at,
                 undo_expires_at, restored_at, purged_at
          FROM deletion_operations_v2;

          CREATE TABLE repositories (
            repository_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider TEXT NOT NULL CHECK (provider IN ('GITHUB', 'GITLAB')),
            remote_id TEXT NOT NULL,
            repository_full_name TEXT NOT NULL,
            clone_url TEXT NOT NULL,
            web_url TEXT NOT NULL,
            default_branch TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deletion_id TEXT REFERENCES deletion_operations (deletion_id),
            deleted_at TEXT,
            UNIQUE (provider, remote_id)
          ) STRICT;

          CREATE INDEX repositories_by_deletion_id ON repositories (deletion_id);

          INSERT INTO repositories (
            repository_id, name, provider, remote_id, repository_full_name,
            clone_url, web_url, default_branch, created_at, updated_at,
            deletion_id, deleted_at
          )
          SELECT project_id, name, provider, remote_id, repository_full_name,
                 clone_url, web_url, default_branch, created_at, updated_at,
                 deletion_id, deleted_at
          FROM projects_v2;

          CREATE UNIQUE INDEX run_repositories_one_primary
            ON run_repositories (run_id) WHERE is_primary = 1;

          UPDATE workflows
          SET definition_json = json_set(
            json_remove(
              definition_json,
              '$.configuration.projectIds',
              '$.configuration.primaryProjectId'
            ),
            '$.schemaVersion', 2,
            '$.configuration.repositoryIds',
            json_extract(definition_json, '$.configuration.projectIds'),
            '$.configuration.primaryRepositoryId',
            json_extract(definition_json, '$.configuration.primaryProjectId')
          )
          WHERE json_type(definition_json, '$.configuration') = 'object';

          UPDATE runs
          SET workflow_snapshot_json = json_set(
            json_remove(
              workflow_snapshot_json,
              '$.configuration.projectIds',
              '$.configuration.primaryProjectId'
            ),
            '$.schemaVersion', 2,
            '$.configuration.repositoryIds',
            json_extract(workflow_snapshot_json, '$.configuration.projectIds'),
            '$.configuration.primaryRepositoryId',
            json_extract(workflow_snapshot_json, '$.configuration.primaryProjectId')
          )
          WHERE json_type(workflow_snapshot_json, '$.configuration') = 'object';

          UPDATE workflow_coordinator_states
          SET state_json = json_set(
            json_remove(
              state_json,
              '$.workflow.configuration.projectIds',
              '$.workflow.configuration.primaryProjectId'
            ),
            '$.workflow.schemaVersion', 2,
            '$.workflow.configuration.repositoryIds',
            json_extract(state_json, '$.workflow.configuration.projectIds'),
            '$.workflow.configuration.primaryRepositoryId',
            json_extract(state_json, '$.workflow.configuration.primaryProjectId')
          )
          WHERE json_type(state_json, '$.workflow.configuration') = 'object';

          DROP TABLE projects_v2;
          DROP TABLE deletion_operations_v2;
          UPDATE schema_metadata
          SET version = 3, applied_at = '2026-08-25T00:00:00.000Z'
          WHERE version = 2 AND name = 'current_schema';
        `)
      })
      .immediate()
  } finally {
    database.pragma('foreign_keys = ON')
  }
}

const migrateVersionThree = (database: Database): void => {
  database.pragma('foreign_keys = OFF')
  try {
    database
      .transaction(() => {
        database.exec(`
          DROP INDEX deletion_operations_pending_subject;

          CREATE TABLE deletion_operations_v4 (
            deletion_id TEXT PRIMARY KEY,
            subject_type TEXT NOT NULL CHECK (subject_type IN ('REPOSITORY', 'WORKFLOW')),
            subject_id TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('PENDING', 'UNDONE', 'PURGED')),
            deleted_at TEXT NOT NULL,
            undo_expires_at TEXT NOT NULL,
            restored_at TEXT,
            purged_at TEXT
          ) STRICT;

          INSERT INTO deletion_operations_v4 (
            deletion_id, subject_type, subject_id, state, deleted_at,
            undo_expires_at, restored_at, purged_at
          )
          SELECT deletion_id, subject_type, subject_id, state, deleted_at,
                 undo_expires_at, restored_at, purged_at
          FROM deletion_operations;

          DROP TABLE deletion_operations;
          ALTER TABLE deletion_operations_v4 RENAME TO deletion_operations;

          CREATE UNIQUE INDEX deletion_operations_pending_subject
            ON deletion_operations (subject_type, subject_id)
            WHERE state = 'PENDING';

          ALTER TABLE workflows
            ADD COLUMN deletion_id TEXT REFERENCES deletion_operations (deletion_id);
          ALTER TABLE workflows ADD COLUMN deleted_at TEXT;
          CREATE INDEX workflows_by_deletion_id ON workflows (deletion_id);

          UPDATE schema_metadata
          SET version = 4, applied_at = '2026-08-25T18:00:00.000Z'
          WHERE version = 3 AND name = 'current_schema';
        `)
      })
      .immediate()
  } finally {
    database.pragma('foreign_keys = ON')
  }
}

const createCurrentSchema = (database: Database): void => {
  const initialize = database.transaction(() => {
    database.exec(CURRENT_SCHEMA)
    database
      .prepare('INSERT INTO schema_metadata (version, name, applied_at) VALUES (?, ?, ?)')
      .run(CURRENT_SCHEMA_MARKER.version, CURRENT_SCHEMA_MARKER.name, '2026-08-23T00:00:00.000Z')
    database.pragma(`application_id = ${SLOPIFY_DATABASE_APPLICATION_ID}`)
  })
  initialize.immediate()
}

export const initializeCurrentSchema = (database: Database): void => {
  const applicationId = database.pragma('application_id', { simple: true })
  const tables = listTables(database)
  if (tables.length === 0 && applicationId === 0) {
    createCurrentSchema(database)
    return
  }
  if (applicationId !== SLOPIFY_DATABASE_APPLICATION_ID || !isCurrentSchema(database, tables)) {
    if (applicationId === SLOPIFY_DATABASE_APPLICATION_ID) {
      if (isVersionOneSchema(database, tables)) migrateVersionOne(database)
      if (isVersionTwoSchema(database, listTables(database))) migrateVersionTwo(database)
      if (isVersionThreeSchema(database, listTables(database))) migrateVersionThree(database)
      if (isCurrentSchema(database, listTables(database))) return
    }
    throw new DatabaseSchemaIncompatibleError(
      'Database does not belong to the current Slopify storage generation',
    )
  }
}
