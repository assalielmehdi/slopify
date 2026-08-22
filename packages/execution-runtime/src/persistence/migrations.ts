import type BetterSqlite3 from 'better-sqlite3'

export interface Migration {
  readonly version: number
  readonly name: string
  readonly foreignKeysDisabled?: boolean
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
  Object.freeze({
    version: 3,
    name: 'persist_optional_run_notes',
    up(database: BetterSqlite3.Database) {
      database.exec(`
        ALTER TABLE runs
          ADD COLUMN notes TEXT
          CHECK (notes IS NULL OR length(trim(notes)) BETWEEN 1 AND 2000);
      `)
    },
  }),
  Object.freeze({
    version: 4,
    name: 'persist_connection_metadata',
    up(database: BetterSqlite3.Database) {
      database.exec(`
        CREATE TABLE connections (
          connection_id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK (
            type IN ('gitlab', 'clickup', 'openrouter', 'chatgpt-subscription')
          ),
          category TEXT NOT NULL CHECK (category IN ('connector', 'inference')),
          label TEXT NOT NULL,
          authority TEXT NOT NULL,
          configuration_json TEXT NOT NULL CHECK (json_valid(configuration_json)),
          metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
          status TEXT NOT NULL CHECK (status IN ('CONNECTED', 'INVALID')),
          validated_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX connections_by_category_type
          ON connections (category, type, label);
      `)
    },
  }),
  Object.freeze({
    version: 5,
    name: 'create_durable_execution_queue',
    up(database: BetterSqlite3.Database) {
      database.exec(`
        DROP INDEX runs_one_active;

        CREATE TABLE execution_messages (
          id TEXT PRIMARY KEY,
          destination TEXT NOT NULL CHECK (destination IN ('WORKER', 'COORDINATOR')),
          type TEXT NOT NULL CHECK (
            type IN (
              'EXECUTE_JOB', 'JOB_STARTED', 'JOB_PROGRESS',
              'JOB_SUCCEEDED', 'JOB_FAILED', 'JOB_CANCELLED'
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
            (destination = 'WORKER' AND type = 'EXECUTE_JOB')
            OR (destination = 'COORDINATOR' AND type <> 'EXECUTE_JOB')
          ),
          FOREIGN KEY (run_id) REFERENCES runs (run_id)
        ) STRICT;

        CREATE INDEX execution_messages_by_destination_status_availability
          ON execution_messages (
            destination, status, available_at, lease_expires_at, id
          );

        CREATE INDEX execution_messages_by_run
          ON execution_messages (run_id, created_at, id);
      `)
    },
  }),
  Object.freeze({
    version: 6,
    name: 'persist_workflow_coordinator_state',
    up(database: BetterSqlite3.Database) {
      database.exec(`
        CREATE TABLE workflow_coordinator_states (
          run_id TEXT PRIMARY KEY,
          state_json TEXT NOT NULL CHECK (json_valid(state_json)),
          updated_at TEXT NOT NULL,
          FOREIGN KEY (run_id) REFERENCES runs (run_id)
        ) STRICT;
      `)
    },
  }),
  Object.freeze({
    version: 7,
    name: 'persist_node_attempt_identity',
    up(database: BetterSqlite3.Database) {
      database.exec(`
        ALTER TABLE node_executions ADD COLUMN attempt_id TEXT;
        CREATE UNIQUE INDEX node_executions_by_attempt
          ON node_executions (run_id, attempt_id)
          WHERE attempt_id IS NOT NULL;
      `)
    },
  }),
  Object.freeze({
    version: 8,
    name: 'persist_connection_catalog',
    up(database: BetterSqlite3.Database) {
      database.exec(`
        CREATE TABLE connection_catalog (
          type TEXT PRIMARY KEY CHECK (
            type IN ('gitlab', 'clickup', 'openrouter', 'chatgpt-subscription')
          ),
          category TEXT NOT NULL CHECK (category IN ('connector', 'inference')),
          name TEXT NOT NULL,
          icon TEXT NOT NULL CHECK (icon IN ('gitlab', 'clickup', 'openrouter', 'chatgpt')),
          eyebrow TEXT NOT NULL,
          summary TEXT NOT NULL,
          description TEXT NOT NULL,
          setup_json TEXT NOT NULL CHECK (json_valid(setup_json)),
          access TEXT NOT NULL,
          input_label TEXT,
          input_description TEXT,
          replacement_input_label TEXT,
          resource_href TEXT,
          resource_label TEXT,
          sort_order INTEGER NOT NULL UNIQUE CHECK (sort_order >= 0)
        ) STRICT;

        CREATE INDEX connection_catalog_by_category_order
          ON connection_catalog (category, sort_order);
      `)

      const insert = database.prepare(`
        INSERT INTO connection_catalog (
          type, category, name, icon, eyebrow, summary, description, setup_json,
          access, input_label, input_description, replacement_input_label,
          resource_href, resource_label, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const credentialDescription =
        "Validated before it is stored in Slopify's owner-only local store."
      const entries = [
        [
          'gitlab',
          'connector',
          'GitLab',
          'gitlab',
          'Source control',
          'Read repositories and manage delivery through GitLab.',
          'Connect GitLab so workflows can inspect projects, create branches, push changes, and manage merge requests available to your user.',
          JSON.stringify([
            'Open GitLab personal access token settings.',
            'Create a token named Slopify with the api scope and an appropriate expiration.',
            'Copy the token and paste it below. GitLab only shows it once.',
          ]),
          'This scope grants read and write API access, limited by the projects and permissions already available to your GitLab user.',
          'Personal access token',
          credentialDescription,
          'New personal access token',
          'https://gitlab.com/-/user_settings/personal_access_tokens?name=Slopify&description=Slopify+local+workflow+connector&scopes=api',
          'Create a personal access token',
          0,
        ],
        [
          'clickup',
          'connector',
          'ClickUp',
          'clickup',
          'Task management',
          'Resolve tasks and publish workflow evidence to ClickUp.',
          'Connect your ClickUp account so workflows can read task context, add review artifacts, and update task status in your accessible Workspaces.',
          JSON.stringify([
            'Open ClickUp Settings, then Apps.',
            'Generate or reveal your personal API token under API Token.',
            'Copy the token and paste it below.',
          ]),
          'A personal token inherits your ClickUp access. Slopify validates it by loading your user and available Workspaces.',
          'Personal API token',
          credentialDescription,
          'New personal API token',
          'https://app.clickup.com/settings/apps',
          'Open ClickUp API settings',
          1,
        ],
        [
          'openrouter',
          'inference',
          'OpenRouter',
          'openrouter',
          'Inference provider',
          'Run agents across models available through OpenRouter.',
          'Use one OpenRouter API key to make its model catalog available to workflow agent jobs.',
          JSON.stringify([
            'Create a key in OpenRouter settings.',
            'Optionally set a spending limit for the key.',
            'Copy the key and paste it below. Slopify validates it before storing it locally.',
          ]),
          'The key is used only by the trusted worker for model inference. It is never exposed to workflow prompts or agent sandboxes.',
          'OpenRouter API key',
          credentialDescription,
          'New OpenRouter API key',
          'https://openrouter.ai/settings/keys',
          'Create an API key',
          2,
        ],
        [
          'chatgpt-subscription',
          'inference',
          'ChatGPT',
          'chatgpt',
          'Subscription provider',
          'Use a ChatGPT subscription through Pi’s OpenAI Codex provider.',
          'Connect your ChatGPT account in the browser. Pi stores the resulting OAuth credential in Slopify’s owner-only local credential store.',
          JSON.stringify([
            'Start the connection from Slopify.',
            'Continue in the browser and approve the ChatGPT sign-in flow.',
            'Return to Slopify; connection status updates automatically.',
          ]),
          'This uses ChatGPT subscription authentication through Pi’s OpenAI Codex provider, not an OpenAI Platform API key.',
          null,
          null,
          null,
          'https://chatgpt.com/',
          'Open ChatGPT',
          3,
        ],
      ] as const

      for (const entry of entries) insert.run(...entry)
    },
  }),
  Object.freeze({
    version: 9,
    name: 'persist_local_git_projects',
    up(database: BetterSqlite3.Database) {
      database.exec(`
        CREATE TABLE projects (
          project_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          repository_path TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
      `)
    },
  }),
  Object.freeze({
    version: 10,
    name: 'update_openrouter_description',
    up(database: BetterSqlite3.Database) {
      database
        .prepare("UPDATE connection_catalog SET description = ? WHERE type = 'openrouter'")
        .run(
          'Use one OpenRouter API key to make its model catalog available to workflow agent jobs.',
        )
    },
  }),
  Object.freeze({
    version: 11,
    name: 'replace_workflow_revisions_with_run_snapshots',
    foreignKeysDisabled: true,
    up(database: BetterSqlite3.Database) {
      database.exec(`
        ALTER TABLE workflows ADD COLUMN description TEXT NOT NULL DEFAULT '';
        ALTER TABLE workflows
          ADD COLUMN definition_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(definition_json));
        ALTER TABLE workflows ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

        CREATE TEMP TABLE latest_workflow_definitions AS
        SELECT workflow_id, definition_json, created_at
        FROM workflow_revisions AS candidate
        WHERE NOT EXISTS (
          SELECT 1
          FROM workflow_revisions AS newer
          WHERE newer.workflow_id = candidate.workflow_id
            AND (
              newer.created_at > candidate.created_at
              OR (
                newer.created_at = candidate.created_at
                AND newer.revision_id > candidate.revision_id
              )
            )
        );

        UPDATE workflows
        SET
          name = COALESCE(
            json_extract(
              (SELECT definition_json FROM latest_workflow_definitions
               WHERE workflow_id = workflows.workflow_id),
              '$.name'
            ),
            name
          ),
          description = COALESCE(
            json_extract(
              (SELECT definition_json FROM latest_workflow_definitions
               WHERE workflow_id = workflows.workflow_id),
              '$.description'
            ),
            ''
          ),
          definition_json = json_set(
            json_remove(
              COALESCE(
                (SELECT definition_json FROM latest_workflow_definitions
                 WHERE workflow_id = workflows.workflow_id),
                '{}'
              ),
              '$.revisionId',
              '$.parentRevisionId'
            ),
            '$.createdAt',
            created_at,
            '$.updatedAt',
            COALESCE(
              (SELECT created_at FROM latest_workflow_definitions
               WHERE workflow_id = workflows.workflow_id),
              created_at
            )
          ),
          updated_at = COALESCE(
            (SELECT created_at FROM latest_workflow_definitions
             WHERE workflow_id = workflows.workflow_id),
            created_at
          );

        DROP TABLE latest_workflow_definitions;

        PRAGMA legacy_alter_table = ON;
        ALTER TABLE runs RENAME TO runs_with_revisions;

        CREATE TABLE runs (
          run_id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          profile_snapshot_id TEXT NOT NULL,
          task_reference TEXT NOT NULL,
          task_snapshot_json TEXT NOT NULL CHECK (json_valid(task_snapshot_json)),
          workflow_snapshot_json TEXT NOT NULL CHECK (json_valid(workflow_snapshot_json)),
          status TEXT NOT NULL CHECK (
            status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED')
          ),
          current_node_id TEXT,
          transition_count INTEGER NOT NULL DEFAULT 0 CHECK (transition_count >= 0),
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          notes TEXT CHECK (notes IS NULL OR length(trim(notes)) BETWEEN 1 AND 2000),
          UNIQUE (run_id, profile_snapshot_id),
          FOREIGN KEY (workflow_id) REFERENCES workflows (workflow_id),
          FOREIGN KEY (profile_snapshot_id)
            REFERENCES project_profile_snapshots (snapshot_id)
        ) STRICT;

        INSERT INTO runs (
          run_id, workflow_id, profile_snapshot_id, task_reference, notes,
          task_snapshot_json, workflow_snapshot_json, status, current_node_id,
          transition_count, created_at, started_at, completed_at
        )
        SELECT
          run_id, workflow_id, profile_snapshot_id, task_reference, notes,
          task_snapshot_json,
          json_set(
            json_remove(
              effective_configuration_json,
              '$.revisionId',
              '$.parentRevisionId'
            ),
            '$.updatedAt',
            COALESCE(json_extract(effective_configuration_json, '$.createdAt'), created_at)
          ),
          status, current_node_id, transition_count, created_at, started_at, completed_at
        FROM runs_with_revisions;

        DROP TABLE runs_with_revisions;
        CREATE INDEX runs_by_created_at ON runs (created_at DESC, run_id DESC);
        PRAGMA legacy_alter_table = OFF;

        UPDATE run_events
        SET data_json = json_remove(data_json, '$.revisionId')
        WHERE event_type = 'RUN_STARTED';

        DROP TRIGGER workflow_revisions_no_update;
        DROP TRIGGER workflow_revisions_no_delete;
        DROP TABLE workflow_revisions;
      `)
    },
  }),
  Object.freeze({
    version: 12,
    name: 'persist_run_variables',
    foreignKeysDisabled: true,
    up(database: BetterSqlite3.Database) {
      database.exec(`
        PRAGMA legacy_alter_table = ON;
        ALTER TABLE runs RENAME TO runs_with_task_inputs;

        CREATE TABLE runs (
          run_id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          variables_json TEXT NOT NULL CHECK (json_valid(variables_json)),
          missing_variables_json TEXT NOT NULL CHECK (json_valid(missing_variables_json)),
          workflow_snapshot_json TEXT NOT NULL CHECK (json_valid(workflow_snapshot_json)),
          status TEXT NOT NULL CHECK (
            status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED')
          ),
          current_node_id TEXT,
          transition_count INTEGER NOT NULL DEFAULT 0 CHECK (transition_count >= 0),
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          profile_snapshot_id TEXT,
          task_reference TEXT,
          task_snapshot_json TEXT CHECK (
            task_snapshot_json IS NULL OR json_valid(task_snapshot_json)
          ),
          notes TEXT CHECK (notes IS NULL OR length(trim(notes)) BETWEEN 1 AND 2000),
          UNIQUE (run_id, profile_snapshot_id),
          FOREIGN KEY (workflow_id) REFERENCES workflows (workflow_id),
          FOREIGN KEY (profile_snapshot_id)
            REFERENCES project_profile_snapshots (snapshot_id)
        ) STRICT;

        INSERT INTO runs (
          run_id, workflow_id, variables_json, missing_variables_json,
          workflow_snapshot_json, status, current_node_id, transition_count,
          created_at, started_at, completed_at, profile_snapshot_id,
          task_reference, task_snapshot_json, notes
        )
        SELECT
          run_id,
          workflow_id,
          CASE
            WHEN length(trim(task_reference)) > 0
              THEN json_object('taskReference', task_reference)
            ELSE json('{}')
          END,
          json('[]'),
          workflow_snapshot_json,
          status,
          current_node_id,
          transition_count,
          created_at,
          started_at,
          completed_at,
          profile_snapshot_id,
          task_reference,
          task_snapshot_json,
          notes
        FROM runs_with_task_inputs;

        DROP TABLE runs_with_task_inputs;
        CREATE INDEX runs_by_created_at ON runs (created_at DESC, run_id DESC);
        PRAGMA legacy_alter_table = OFF;

        UPDATE run_events
        SET data_json = json_remove(data_json, '$.profileId', '$.taskReference')
        WHERE event_type = 'RUN_STARTED';
      `)
    },
  }),
  Object.freeze({
    version: 13,
    name: 'add_reversible_deletions',
    up(database: BetterSqlite3.Database) {
      database.exec(`
        CREATE TABLE deletion_operations (
          deletion_id TEXT PRIMARY KEY,
          subject_type TEXT NOT NULL CHECK (subject_type IN ('PROJECT')),
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

        ALTER TABLE projects ADD COLUMN deletion_id TEXT REFERENCES deletion_operations(deletion_id);
        ALTER TABLE projects ADD COLUMN deleted_at TEXT;
        CREATE INDEX projects_by_deletion_id ON projects (deletion_id);
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

    const foreignKeysDisabled = migration.foreignKeysDisabled === true
    if (foreignKeysDisabled) database.pragma('foreign_keys = OFF')
    try {
      const migrate = database.transaction(() => {
        migration.up(database)
        if (foreignKeysDisabled) {
          const violations = database.pragma('foreign_key_check') as unknown[]
          if (violations.length > 0) throw new Error('Migration introduced foreign-key violations')
        }
        database
          .prepare(
            `INSERT INTO schema_migrations (version, name, applied_at)
             VALUES (?, ?, ?)`,
          )
          .run(migration.version, migration.name, new Date().toISOString())
      })

      migrate.immediate()
    } finally {
      if (foreignKeysDisabled) database.pragma('foreign_keys = ON')
    }
  }
}
