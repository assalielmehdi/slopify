import type { Database } from './sqlite.js'

export const SLOPIFY_DATABASE_APPLICATION_ID = 0x534c5059
export const CURRENT_SCHEMA_MARKER = Object.freeze({ version: 1, name: 'current_schema' })

const CURRENT_TABLES = Object.freeze([
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

const CURRENT_SCHEMA = `
  CREATE TABLE schema_metadata (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE workflows (
    workflow_id TEXT PRIMARY KEY,
    definition_json TEXT NOT NULL CHECK (json_valid(definition_json))
  ) STRICT;

  CREATE TABLE deletion_operations (
    deletion_id TEXT PRIMARY KEY,
    subject_type TEXT NOT NULL CHECK (subject_type = 'PROJECT'),
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

  CREATE TABLE projects (
    project_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repository_path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deletion_id TEXT REFERENCES deletion_operations (deletion_id),
    deleted_at TEXT
  ) STRICT;

  CREATE INDEX projects_by_deletion_id ON projects (deletion_id);

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

  CREATE TABLE run_projects (
    run_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    project_position INTEGER NOT NULL CHECK (project_position >= 0),
    name TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    base_sha TEXT NOT NULL CHECK (
      base_sha NOT GLOB '*[^0-9a-f]*'
      AND length(base_sha) IN (40, 64)
    ),
    source_branch TEXT,
    is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
    PRIMARY KEY (run_id, project_id),
    UNIQUE (run_id, project_position),
    UNIQUE (run_id, repository_path),
    FOREIGN KEY (run_id) REFERENCES runs (run_id)
  ) STRICT;

  CREATE UNIQUE INDEX run_projects_one_primary
    ON run_projects (run_id)
    WHERE is_primary = 1;

  CREATE TABLE run_project_worktrees (
    run_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PREPARING', 'READY', 'FAILED')),
    worktree_path TEXT NOT NULL UNIQUE,
    error_message TEXT,
    prepared_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, project_id),
    FOREIGN KEY (run_id, project_id) REFERENCES run_projects (run_id, project_id),
    CHECK (
      (status = 'PREPARING' AND error_message IS NULL AND prepared_at IS NULL)
      OR (status = 'READY' AND error_message IS NULL AND prepared_at IS NOT NULL)
      OR (status = 'FAILED' AND error_message IS NOT NULL AND prepared_at IS NULL)
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
    const markers = database
      .prepare('SELECT version, name FROM schema_metadata ORDER BY version')
      .all() as SchemaMarkerRow[]
    return (
      markers.length === 1 &&
      markers[0]?.version === CURRENT_SCHEMA_MARKER.version &&
      markers[0]?.name === CURRENT_SCHEMA_MARKER.name
    )
  } catch {
    return false
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
    throw new DatabaseSchemaIncompatibleError(
      'Database does not belong to the current Slopify storage generation',
    )
  }
}
