import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createSqliteCoordinatorStateStore,
  createSqliteExecutionMessageQueue,
  createWorkflowCoordinator,
  openDatabase,
  type WorkbenchDatabase,
} from '../../src/index.js'
import { getDatabaseHandle } from '../../src/persistence/database.js'

const databases: WorkbenchDatabase[] = []
const directories: string[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const workflow = {
  workflowId: 'workflow-01',
  name: 'Workflow',
  description: 'One agent job.',
  startNodeId: 'agent',
  nodes: [
    {
      type: 'agent' as const,
      id: 'agent',
      name: 'Agent',
      description: 'Run the agent.',
      timeoutSeconds: 60,
      result: { schemaRef: 'json:any-v1' },
      sandbox: { profileId: 'agent-default-v1', imageId: 'gondolin-alpine-v1' },
      job: {
        kind: 'agent' as const,
        prompt: 'Complete the job.',
        skillSnapshotRefs: [],
        inference: {
          connectionId: 'openrouter-primary',
          modelId: 'openai/gpt-5.4',
          thinkingLevel: 'medium' as const,
        },
        connectorIds: [],
      },
    },
  ],
  edges: [],
  maxTransitions: 0,
  createdAt: '2026-08-20T10:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
}

describe('SQLite workflow coordinator', () => {
  it('commits coordinator state, run history, and successor commands atomically', () => {
    const directory = join(tmpdir(), `slopify-coordinator-${crypto.randomUUID()}`)
    directories.push(directory)
    const database = openDatabase({ path: join(directory, 'state.sqlite') })
    databases.push(database)
    const connection = getDatabaseHandle(database)
    const timestamp = workflow.createdAt
    connection.exec(`
      INSERT INTO workflows (
        workflow_id, name, description, definition_json, created_at, updated_at
      ) VALUES (
        'workflow-01', 'Workflow', 'One agent job.',
        '${JSON.stringify(workflow).replaceAll("'", "''")}', '${timestamp}', '${timestamp}'
      );
      INSERT INTO project_profiles (
        profile_id, display_name, clickup_workspace_id, clickup_list_id,
        clickup_in_review_status_id, created_at, updated_at
      ) VALUES (
        'profile-01', 'Profile', 'workspace-01', 'list-01', 'review',
        '${timestamp}', '${timestamp}'
      );
      INSERT INTO project_profile_snapshots (
        snapshot_id, profile_id, display_name, clickup_workspace_id,
        clickup_list_id, clickup_in_review_status_id, created_at
      ) VALUES (
        'snapshot-01', 'profile-01', 'Profile', 'workspace-01',
        'list-01', 'review', '${timestamp}'
      );
      INSERT INTO runs (
        run_id, workflow_id, profile_snapshot_id, task_reference,
        task_snapshot_json, workflow_snapshot_json, variables_json,
        missing_variables_json, status, created_at
      ) VALUES (
        'run-01', 'workflow-01', 'snapshot-01', 'TASK-1',
        '{}', '${JSON.stringify(workflow).replaceAll("'", "''")}', '{}', '[]',
        'PENDING', '${timestamp}'
      );
      INSERT INTO run_events (run_id, sequence, event_type, data_json, created_at)
      VALUES ('run-01', 1, 'RUN_STARTED', '{}', '${timestamp}');
    `)
    const queue = createSqliteExecutionMessageQueue(database)
    const state = createSqliteCoordinatorStateStore(database)
    let id = 0
    const coordinator = createWorkflowCoordinator({
      coordinatorId: 'coordinator-01',
      queue,
      state,
      now: () => timestamp,
      createId: (prefix) => `${prefix}-${++id}`,
    })

    coordinator.start({ runId: 'run-01', workflow })
    const execution = state.get('run-01')?.executions[0]
    if (execution === undefined) throw new Error('execution missing')
    queue.enqueue({
      id: 'success-01',
      destination: 'COORDINATOR',
      type: 'JOB_SUCCEEDED',
      runId: 'run-01',
      nodeExecutionId: execution.nodeExecutionId,
      attemptId: execution.attemptId,
      payload: {
        version: 1,
        outcome: 'completed',
        output: { summary: 'Done' },
        artifactIds: [],
        completedAt: timestamp,
        durationMs: 1,
      },
      availableAt: timestamp,
      createdAt: timestamp,
    })

    expect(coordinator.runOnce()).toBe(true)
    expect(queue.get('success-01')).toMatchObject({ status: 'PROCESSED' })
    expect(state.get('run-01')).toMatchObject({ status: 'SUCCEEDED', transitionCount: 0 })
    expect(
      connection.prepare('SELECT status FROM runs WHERE run_id = ?').pluck().get('run-01'),
    ).toBe('SUCCEEDED')
    expect(
      connection
        .prepare('SELECT status FROM node_executions WHERE node_execution_id = ?')
        .pluck()
        .get(execution.nodeExecutionId),
    ).toBe('SUCCEEDED')
    expect(
      connection.prepare('SELECT COUNT(*) FROM run_events WHERE run_id = ?').pluck().get('run-01'),
    ).toBeGreaterThan(2)
  })
})
