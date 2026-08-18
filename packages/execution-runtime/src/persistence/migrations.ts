import type BetterSqlite3 from 'better-sqlite3'

export interface Migration {
  readonly version: number
  readonly name: string
  readonly up: (database: BetterSqlite3.Database) => void
}

const CREATE_EXECUTION_SCHEMA = `
  CREATE TABLE workflows (
    workflow_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE workflow_revisions (
    revision_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    parent_revision_id TEXT,
    name TEXT NOT NULL,
    definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
    created_at TEXT NOT NULL,
    UNIQUE (workflow_id, revision_id),
    FOREIGN KEY (workflow_id) REFERENCES workflows (workflow_id),
    FOREIGN KEY (workflow_id, parent_revision_id)
      REFERENCES workflow_revisions (workflow_id, revision_id)
  ) STRICT;

  CREATE TRIGGER workflow_revisions_no_update
  BEFORE UPDATE ON workflow_revisions
  BEGIN
    SELECT RAISE(ABORT, 'workflow revisions are immutable');
  END;

  CREATE TRIGGER workflow_revisions_no_delete
  BEFORE DELETE ON workflow_revisions
  BEGIN
    SELECT RAISE(ABORT, 'workflow revisions are immutable');
  END;

  CREATE TABLE project_profiles (
    profile_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    clickup_workspace_id TEXT NOT NULL,
    clickup_list_id TEXT NOT NULL,
    clickup_in_review_status_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE project_profile_repositories (
    profile_id TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    profile_position INTEGER NOT NULL CHECK (profile_position >= 0),
    display_name TEXT NOT NULL,
    purpose TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    gitlab_project TEXT NOT NULL,
    remote TEXT NOT NULL,
    target_branch TEXT NOT NULL,
    worktree_parent TEXT NOT NULL,
    branch_template TEXT NOT NULL,
    executable_checks_json TEXT NOT NULL CHECK (json_valid(executable_checks_json)),
    verification_commands_json TEXT NOT NULL CHECK (json_valid(verification_commands_json)),
    merge_request_labels_json TEXT NOT NULL CHECK (json_valid(merge_request_labels_json)),
    PRIMARY KEY (profile_id, repository_id),
    UNIQUE (profile_id, profile_position),
    UNIQUE (profile_id, repository_path),
    FOREIGN KEY (profile_id) REFERENCES project_profiles (profile_id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE project_profile_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    clickup_workspace_id TEXT NOT NULL,
    clickup_list_id TEXT NOT NULL,
    clickup_in_review_status_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES project_profiles (profile_id)
  ) STRICT;

  CREATE TABLE profile_snapshot_repositories (
    snapshot_id TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    profile_position INTEGER NOT NULL CHECK (profile_position >= 0),
    display_name TEXT NOT NULL,
    purpose TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    gitlab_project TEXT NOT NULL,
    remote TEXT NOT NULL,
    target_branch TEXT NOT NULL,
    worktree_parent TEXT NOT NULL,
    branch_template TEXT NOT NULL,
    executable_checks_json TEXT NOT NULL CHECK (json_valid(executable_checks_json)),
    verification_commands_json TEXT NOT NULL CHECK (json_valid(verification_commands_json)),
    merge_request_labels_json TEXT NOT NULL CHECK (json_valid(merge_request_labels_json)),
    PRIMARY KEY (snapshot_id, repository_id),
    UNIQUE (snapshot_id, profile_position),
    UNIQUE (snapshot_id, repository_id, profile_position),
    FOREIGN KEY (snapshot_id) REFERENCES project_profile_snapshots (snapshot_id)
  ) STRICT;

  CREATE TRIGGER project_profile_snapshots_no_update
  BEFORE UPDATE ON project_profile_snapshots
  BEGIN
    SELECT RAISE(ABORT, 'project profile snapshots are immutable');
  END;

  CREATE TRIGGER project_profile_snapshots_no_delete
  BEFORE DELETE ON project_profile_snapshots
  BEGIN
    SELECT RAISE(ABORT, 'project profile snapshots are immutable');
  END;

  CREATE TRIGGER profile_snapshot_repositories_no_update
  BEFORE UPDATE ON profile_snapshot_repositories
  BEGIN
    SELECT RAISE(ABORT, 'project profile snapshots are immutable');
  END;

  CREATE TRIGGER profile_snapshot_repositories_no_delete
  BEFORE DELETE ON profile_snapshot_repositories
  BEGIN
    SELECT RAISE(ABORT, 'project profile snapshots are immutable');
  END;

  CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    profile_snapshot_id TEXT NOT NULL,
    task_reference TEXT NOT NULL,
    task_snapshot_json TEXT NOT NULL CHECK (json_valid(task_snapshot_json)),
    effective_configuration_json TEXT NOT NULL CHECK (json_valid(effective_configuration_json)),
    status TEXT NOT NULL CHECK (
      status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED')
    ),
    current_node_id TEXT,
    transition_count INTEGER NOT NULL DEFAULT 0 CHECK (transition_count >= 0),
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    UNIQUE (run_id, profile_snapshot_id),
    FOREIGN KEY (workflow_id, revision_id)
      REFERENCES workflow_revisions (workflow_id, revision_id),
    FOREIGN KEY (profile_snapshot_id)
      REFERENCES project_profile_snapshots (snapshot_id)
  ) STRICT;

  CREATE UNIQUE INDEX runs_one_active
    ON runs (status)
    WHERE status = 'RUNNING';

  CREATE INDEX runs_by_created_at
    ON runs (created_at DESC, run_id DESC);

  CREATE TABLE run_repository_selections (
    run_id TEXT NOT NULL,
    profile_snapshot_id TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    profile_position INTEGER NOT NULL CHECK (profile_position >= 0),
    responsibility TEXT NOT NULL,
    selected_at TEXT NOT NULL,
    PRIMARY KEY (run_id, repository_id),
    UNIQUE (run_id, profile_position),
    FOREIGN KEY (run_id, profile_snapshot_id)
      REFERENCES runs (run_id, profile_snapshot_id),
    FOREIGN KEY (profile_snapshot_id, repository_id, profile_position)
      REFERENCES profile_snapshot_repositories (
        snapshot_id, repository_id, profile_position
      )
  ) STRICT;

  CREATE INDEX run_repository_selections_by_profile_order
    ON run_repository_selections (run_id, profile_position);

  CREATE TABLE run_workspaces (
    run_id TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    repository_path TEXT NOT NULL,
    worktree_path TEXT NOT NULL UNIQUE,
    remote TEXT NOT NULL,
    target_branch TEXT NOT NULL,
    source_branch TEXT NOT NULL,
    base_sha TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (run_id, repository_id),
    FOREIGN KEY (run_id, repository_id)
      REFERENCES run_repository_selections (run_id, repository_id)
  ) STRICT;

  CREATE TABLE node_executions (
    node_execution_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    execution_index INTEGER NOT NULL CHECK (execution_index > 0),
    status TEXT NOT NULL CHECK (
      status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED')
    ),
    input_references_json TEXT NOT NULL CHECK (json_valid(input_references_json)),
    output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
    outcome TEXT,
    error_code TEXT,
    error_message TEXT,
    selected_target_node_id TEXT,
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    UNIQUE (run_id, node_execution_id),
    UNIQUE (run_id, execution_index),
    FOREIGN KEY (run_id) REFERENCES runs (run_id)
  ) STRICT;

  CREATE INDEX node_executions_by_run
    ON node_executions (run_id, execution_index);

  CREATE TABLE run_events (
    run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    event_type TEXT NOT NULL CHECK (
      event_type IN (
        'RUN_STARTED', 'RUN_STATUS_CHANGED', 'NODE_STARTED', 'NODE_OUTPUT',
        'NODE_COMPLETED', 'NODE_FAILED', 'EDGE_SELECTED', 'ARTIFACT_RECORDED',
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

  CREATE TABLE output_chunks (
    run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    event_sequence INTEGER NOT NULL CHECK (event_sequence > 0),
    node_execution_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('stdout', 'stderr', 'agent')),
    repository_id TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (run_id, sequence),
    UNIQUE (run_id, event_sequence),
    FOREIGN KEY (run_id, event_sequence) REFERENCES run_events (run_id, sequence),
    FOREIGN KEY (run_id, node_execution_id)
      REFERENCES node_executions (run_id, node_execution_id),
    FOREIGN KEY (run_id, repository_id)
      REFERENCES run_repository_selections (run_id, repository_id)
  ) STRICT;

  CREATE TABLE artifacts (
    artifact_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    node_execution_id TEXT NOT NULL,
    artifact_type TEXT NOT NULL CHECK (
      artifact_type IN (
        'EXECUTION_PLAN', 'IMPLEMENTATION_SUMMARY', 'REVIEW_SUMMARY', 'FINALIZATION'
      )
    ),
    content TEXT NOT NULL,
    metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL,
    UNIQUE (run_id, artifact_type),
    FOREIGN KEY (run_id) REFERENCES runs (run_id),
    FOREIGN KEY (run_id, node_execution_id)
      REFERENCES node_executions (run_id, node_execution_id)
  ) STRICT;

  CREATE TABLE repository_delivery_evidence (
    run_id TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('PENDING', 'BRANCH_PUSHED', 'MERGE_REQUEST_CREATED', 'VERIFIED', 'FAILED')
    ),
    gitlab_project TEXT,
    merge_request_iid INTEGER CHECK (merge_request_iid IS NULL OR merge_request_iid > 0),
    merge_request_url TEXT,
    source_branch TEXT,
    target_branch TEXT,
    head_sha TEXT,
    evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, repository_id),
    FOREIGN KEY (run_id, repository_id)
      REFERENCES run_repository_selections (run_id, repository_id)
  ) STRICT;
`

export const EXECUTION_RUNTIME_MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({
    version: 1,
    name: 'create_execution_schema',
    up(database: BetterSqlite3.Database) {
      database.exec(CREATE_EXECUTION_SCHEMA)
    },
  }),
  Object.freeze({
    version: 2,
    name: 'persist_complete_repository_selection',
    up(database: BetterSqlite3.Database) {
      database.exec(`
        ALTER TABLE run_repository_selections
          ADD COLUMN rationale TEXT NOT NULL DEFAULT '';

        CREATE TABLE run_repository_selection_snapshots (
          run_id TEXT PRIMARY KEY,
          selection_json TEXT NOT NULL CHECK (json_valid(selection_json)),
          selected_at TEXT NOT NULL,
          FOREIGN KEY (run_id) REFERENCES runs (run_id)
        ) STRICT;

        CREATE TRIGGER run_repository_selection_snapshots_no_update
        BEFORE UPDATE ON run_repository_selection_snapshots
        BEGIN
          SELECT RAISE(ABORT, 'repository selections are immutable');
        END;

        CREATE TRIGGER run_repository_selection_snapshots_no_delete
        BEFORE DELETE ON run_repository_selection_snapshots
        BEGIN
          SELECT RAISE(ABORT, 'repository selections are immutable');
        END;
      `)
    },
  }),
])

interface AppliedMigration {
  readonly version: number
  readonly name: string
}

const validateMigrations = (migrations: readonly Migration[]): void => {
  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Migration ${migration.name} has version ${migration.version}; expected ${expectedVersion}`,
      )
    }
  }
}

export const applyMigrations = (
  database: BetterSqlite3.Database,
  migrations: readonly Migration[] = EXECUTION_RUNTIME_MIGRATIONS,
): void => {
  validateMigrations(migrations)
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) STRICT
  `)

  const appliedMigrations = database
    .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
    .all() as AppliedMigration[]
  const appliedByVersion = new Map(
    appliedMigrations.map((migration) => [migration.version, migration.name]),
  )

  for (const migration of migrations) {
    const appliedName = appliedByVersion.get(migration.version)
    if (appliedName !== undefined) {
      if (appliedName !== migration.name) {
        throw new Error(
          `Applied migration ${migration.version} metadata does not match ${migration.name}`,
        )
      }
      continue
    }

    const migrate = database.transaction(() => {
      migration.up(database)
      database
        .prepare(
          `INSERT INTO schema_migrations (version, name, applied_at)
           VALUES (?, ?, ?)`,
        )
        .run(migration.version, migration.name, new Date().toISOString())
    })

    migrate.immediate()
  }
}
