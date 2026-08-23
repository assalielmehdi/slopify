import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { openDatabase, type WorkbenchDatabase } from '../../src/index.js'
import {
  EXECUTION_RUNTIME_MIGRATIONS,
  applyMigrations,
  type Migration,
} from '../../src/persistence/migrations.js'
import { Database } from '../../src/persistence/sqlite.js'

const openedDatabases: WorkbenchDatabase[] = []
const rawDatabases: Database[] = []
const temporaryDirectories: string[] = []

const createDatabasePath = (): string => {
  const directory = join(tmpdir(), `slopify-migrations-${crypto.randomUUID()}`)
  temporaryDirectories.push(directory)
  const path = join(directory, 'state', 'workbench.sqlite')
  mkdirSync(dirname(path), { recursive: true })
  return path
}

afterEach(() => {
  for (const database of openedDatabases.splice(0)) {
    if (database.isOpen) database.close()
  }

  for (const database of rawDatabases.splice(0)) {
    if (database.open) database.close()
  }

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('forward-only migrations', () => {
  it('records each migration once when a database is reopened', () => {
    const path = createDatabasePath()
    const database = openDatabase({ path })
    database.close()

    const reopened = openDatabase({ path })
    openedDatabases.push(reopened)
    const raw = new Database(path, { readonly: true })
    rawDatabases.push(raw)

    expect(
      raw.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all(),
    ).toEqual([
      { version: 1, name: 'create_execution_schema' },
      { version: 2, name: 'persist_complete_repository_selection' },
      { version: 3, name: 'persist_optional_run_notes' },
      { version: 4, name: 'persist_connection_metadata' },
      { version: 5, name: 'create_durable_execution_queue' },
      { version: 6, name: 'persist_workflow_coordinator_state' },
      { version: 7, name: 'persist_node_attempt_identity' },
      { version: 8, name: 'persist_connection_catalog' },
      { version: 9, name: 'persist_local_git_projects' },
      { version: 10, name: 'update_openrouter_description' },
      { version: 11, name: 'replace_workflow_revisions_with_run_snapshots' },
      { version: 12, name: 'persist_run_variables' },
      { version: 13, name: 'add_reversible_deletions' },
      { version: 14, name: 'persist_inference_model_catalog' },
      { version: 15, name: 'enforce_one_connection_per_type' },
      { version: 16, name: 'link_connectors_to_skills' },
      { version: 17, name: 'rename_connector_skills' },
      { version: 18, name: 'add_figma_connector' },
      { version: 19, name: 'use_figma_desktop_mcp' },
    ])

    expect(
      raw
        .prepare("SELECT description FROM connection_catalog WHERE type = 'openrouter'")
        .pluck()
        .get(),
    ).toBe('Use one OpenRouter API key to make its model catalog available to workflow agent jobs.')
    expect(
      raw
        .prepare(
          "SELECT type, category, icon, summary, resource_href, skill_id FROM connection_catalog WHERE type = 'figma'",
        )
        .get(),
    ).toEqual({
      type: 'figma',
      category: 'connector',
      icon: 'figma',
      summary: 'Inspect the active design through Figma Desktop.',
      resource_href:
        'https://developers.figma.com/docs/figma-mcp-server/local-server-installation/',
      skill_id: 'figma-connector',
    })
  })

  it('invalidates an existing remote Figma connection for desktop revalidation', () => {
    const raw = new Database(createDatabasePath())
    rawDatabases.push(raw)
    applyMigrations(raw, EXECUTION_RUNTIME_MIGRATIONS.slice(0, 18))
    const timestamp = '2026-08-22T20:00:00Z'
    raw
      .prepare(
        `INSERT INTO connections (
          connection_id, type, category, label, authority, configuration_json,
          metadata_json, status, validated_at, created_at, updated_at
        ) VALUES (?, 'figma', 'connector', 'Figma', ?, ?, ?, 'CONNECTED', ?, ?, ?)`,
      )
      .run(
        'figma-default',
        'Read and write Figma resources available to the connected user.',
        JSON.stringify({ serverUrl: 'https://mcp.figma.com/mcp' }),
        JSON.stringify({ tools: [{ name: 'get_design_context' }] }),
        timestamp,
        timestamp,
        timestamp,
      )

    applyMigrations(raw)

    expect(
      raw
        .prepare(
          `SELECT configuration_json, metadata_json, status
           FROM connections WHERE connection_id = 'figma-default'`,
        )
        .get(),
    ).toEqual({
      configuration_json: JSON.stringify({ serverUrl: 'http://127.0.0.1:3845/mcp' }),
      metadata_json: '{}',
      status: 'INVALID',
    })
  })

  it('migrates a populated v10 database to one current workflow and immutable run snapshots', () => {
    const raw = new Database(createDatabasePath())
    rawDatabases.push(raw)
    raw.pragma('foreign_keys = ON')
    applyMigrations(raw, EXECUTION_RUNTIME_MIGRATIONS.slice(0, 10))
    const createdAt = '2026-08-18T20:00:00Z'
    const updatedAt = '2026-08-18T21:00:00Z'
    const workflow = (name: string, revisionId: string, timestamp: string) => ({
      workflowId: 'delivery-workflow',
      revisionId,
      name,
      description: `${name} description`,
      startNodeId: 'agent',
      nodes: [
        {
          type: 'agent',
          id: 'agent',
          name: 'Agent',
          description: 'Run the agent.',
          timeoutSeconds: 60,
          result: { schemaRef: 'json:any-v1' },
          sandbox: { profileId: 'agent-default-v1', imageId: 'gondolin-alpine-v1' },
          job: {
            kind: 'agent',
            prompt: 'Run.',
            skillSnapshotRefs: [],
            inference: {
              connectionId: 'openrouter-default',
              modelId: 'openai/gpt-5.4',
              thinkingLevel: 'medium',
            },
            connectorIds: [],
          },
        },
        { type: 'terminal', id: 'done', name: 'Done', terminalStatus: 'SUCCEEDED' },
      ],
      edges: [{ sourceNodeId: 'agent', outcome: 'completed', targetNodeId: 'done', label: 'Done' }],
      maxTransitions: 2,
      createdAt: timestamp,
    })
    const first = workflow('Initial workflow', 'revision-01', createdAt)
    const latest = workflow('Current workflow', 'revision-02', updatedAt)

    raw
      .prepare('INSERT INTO workflows (workflow_id, name, created_at) VALUES (?, ?, ?)')
      .run('delivery-workflow', first.name, createdAt)
    const insertRevision = raw.prepare(`
      INSERT INTO workflow_revisions (
        revision_id, workflow_id, parent_revision_id, name, definition_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    insertRevision.run(
      'revision-01',
      'delivery-workflow',
      null,
      first.name,
      JSON.stringify(first),
      createdAt,
    )
    insertRevision.run(
      'revision-02',
      'delivery-workflow',
      'revision-01',
      latest.name,
      JSON.stringify(latest),
      updatedAt,
    )
    raw.exec(`
      INSERT INTO project_profiles (
        profile_id, display_name, clickup_workspace_id, clickup_list_id,
        clickup_in_review_status_id, created_at, updated_at
      ) VALUES (
        'profile-01', 'Local', 'workspace-01', 'list-01', 'review', '${createdAt}', '${createdAt}'
      );
      INSERT INTO project_profile_snapshots (
        snapshot_id, profile_id, display_name, clickup_workspace_id,
        clickup_list_id, clickup_in_review_status_id, created_at
      ) VALUES (
        'snapshot-01', 'profile-01', 'Local', 'workspace-01', 'list-01', 'review', '${createdAt}'
      );
    `)
    raw
      .prepare(
        `
        INSERT INTO runs (
          run_id, workflow_id, revision_id, profile_snapshot_id, task_reference,
          task_snapshot_json, effective_configuration_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED', ?)
      `,
      )
      .run(
        'run-01',
        'delivery-workflow',
        'revision-01',
        'snapshot-01',
        'TASK-1',
        '{}',
        JSON.stringify(first),
        createdAt,
      )
    raw
      .prepare(
        `
        INSERT INTO run_events (run_id, sequence, event_type, data_json, created_at)
        VALUES (?, 1, 'RUN_STARTED', ?, ?)
      `,
      )
      .run(
        'run-01',
        JSON.stringify({
          workflowId: 'delivery-workflow',
          revisionId: 'revision-01',
          profileId: 'profile-01',
          taskReference: 'TASK-1',
        }),
        createdAt,
      )

    applyMigrations(raw)

    const storedWorkflow = JSON.parse(
      String(raw.prepare('SELECT definition_json FROM workflows').pluck().get()),
    ) as Record<string, unknown>
    const storedSnapshot = JSON.parse(
      String(raw.prepare('SELECT workflow_snapshot_json FROM runs').pluck().get()),
    ) as Record<string, unknown>
    const started = JSON.parse(
      String(raw.prepare('SELECT data_json FROM run_events').pluck().get()),
    ) as Record<string, unknown>
    const variables = JSON.parse(
      String(raw.prepare('SELECT variables_json FROM runs').pluck().get()),
    ) as Record<string, unknown>
    const missingVariables = JSON.parse(
      String(raw.prepare('SELECT missing_variables_json FROM runs').pluck().get()),
    ) as unknown
    expect(storedWorkflow).toMatchObject({
      workflowId: 'delivery-workflow',
      name: 'Current workflow',
      createdAt,
      updatedAt,
    })
    expect(storedWorkflow).not.toHaveProperty('revisionId')
    expect(storedSnapshot).toMatchObject({
      name: 'Initial workflow',
      createdAt,
      updatedAt: createdAt,
    })
    expect(storedSnapshot).not.toHaveProperty('revisionId')
    expect(variables).toEqual({ taskReference: 'TASK-1' })
    expect(missingVariables).toEqual([])
    expect(started).toEqual({ workflowId: 'delivery-workflow' })
    expect(
      raw.prepare("SELECT name FROM sqlite_master WHERE name = 'workflow_revisions'").get(),
    ).toBeUndefined()
    expect(raw.pragma('foreign_key_check')).toEqual([])
  })

  it('rolls back a failed migration without recording its version', () => {
    const raw = new Database(createDatabasePath())
    rawDatabases.push(raw)
    const failingMigration: Migration = {
      version: 1,
      name: 'failing_migration',
      up(database) {
        database.exec('CREATE TABLE should_roll_back (id INTEGER PRIMARY KEY)')
        throw new Error('planned migration failure')
      },
    }

    expect(() => applyMigrations(raw, [failingMigration])).toThrow('planned migration failure')
    expect(
      raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_roll_back'",
        )
        .get(),
    ).toBeUndefined()
    expect(raw.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(0)
  })

  it('rejects changed metadata for an already-applied migration', () => {
    const raw = new Database(createDatabasePath())
    rawDatabases.push(raw)
    const initial: Migration = {
      version: 1,
      name: 'initial',
      up(database) {
        database.exec('CREATE TABLE durable_record (id INTEGER PRIMARY KEY)')
      },
    }

    applyMigrations(raw, [initial])

    expect(() => applyMigrations(raw, [{ ...initial, name: 'renamed' }])).toThrow(
      /metadata does not match/i,
    )
  })
})
