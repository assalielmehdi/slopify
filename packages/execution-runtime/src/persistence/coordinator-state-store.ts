import { NodeIdSchema, RunIdSchema } from '@loop/contracts'
import type BetterSqlite3 from 'better-sqlite3'

import { appendEvent } from '../events/event-store.js'
import {
  decodeExecutionMessagePayload,
  type NewExecutionMessage,
} from '../orchestration/execution-messages.js'
import {
  CoordinatorRunStateSchema,
  type CoordinatorNodeExecution,
  type CoordinatorRunState,
  type CoordinatorStateStore,
} from '../orchestration/workflow-coordinator.js'
import type { WorkbenchDatabase } from './database.js'
import { getDatabaseHandle } from './database.js'

interface StateRow {
  readonly state_json: string
}

const serializeState = (state: CoordinatorRunState): string =>
  JSON.stringify(CoordinatorRunStateSchema.parse(state))

const readState = (
  connection: BetterSqlite3.Database,
  runId: string,
): CoordinatorRunState | undefined => {
  const row = connection
    .prepare('SELECT state_json FROM workflow_coordinator_states WHERE run_id = ?')
    .get(runId) as StateRow | undefined
  return row === undefined ? undefined : CoordinatorRunStateSchema.parse(JSON.parse(row.state_json))
}

const insertMessage = (connection: BetterSqlite3.Database, message: NewExecutionMessage): void => {
  decodeExecutionMessagePayload({ type: message.type, payload: message.payload })
  connection
    .prepare(
      `INSERT INTO execution_messages (
         id, destination, type, run_id, node_execution_id, attempt_id,
         payload_json, status, available_at, attempts, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 0, ?)`,
    )
    .run(
      message.id,
      message.destination,
      message.type,
      message.runId,
      message.nodeExecutionId,
      message.attemptId,
      JSON.stringify(message.payload),
      message.availableAt,
      message.createdAt,
    )
}

const insertExecution = (
  connection: BetterSqlite3.Database,
  state: CoordinatorRunState,
  execution: CoordinatorNodeExecution,
): void => {
  const index = connection
    .prepare('SELECT COALESCE(MAX(execution_index), 0) + 1 FROM node_executions WHERE run_id = ?')
    .pluck()
    .get(state.runId)
  connection
    .prepare(
      `INSERT INTO node_executions (
         node_execution_id, run_id, node_id, execution_index, status, attempt_id,
         input_references_json
       ) VALUES (?, ?, ?, ?, ?, ?, '[]')`,
    )
    .run(
      execution.nodeExecutionId,
      state.runId,
      execution.nodeId,
      index,
      execution.status,
      execution.attemptId,
    )
}

const syncState = (
  connection: BetterSqlite3.Database,
  previous: CoordinatorRunState | undefined,
  next: CoordinatorRunState,
  messageNodeExecutionId?: string,
): void => {
  const previousExecutions = new Map(
    previous?.executions.map((execution) => [execution.nodeExecutionId, execution]) ?? [],
  )
  for (const execution of next.executions) {
    const existing = previousExecutions.get(execution.nodeExecutionId)
    if (existing === undefined) {
      insertExecution(connection, next, execution)
      continue
    }
    if (JSON.stringify(existing) === JSON.stringify(execution)) continue
    connection
      .prepare(
        `UPDATE node_executions
         SET status = ?, outcome = ?, output_json = ?,
             started_at = CASE WHEN ? = 'RUNNING' THEN COALESCE(started_at, ?) ELSE started_at END,
             completed_at = CASE WHEN ? IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN ? ELSE completed_at END,
             error_code = CASE WHEN ? IN ('FAILED', 'CANCELLED') THEN ? ELSE error_code END
         WHERE run_id = ? AND node_execution_id = ?`,
      )
      .run(
        execution.status,
        execution.outcome ?? null,
        execution.output === undefined ? null : JSON.stringify(execution.output),
        execution.status,
        next.events.at(-1)?.timestamp ?? null,
        execution.status,
        next.events.at(-1)?.timestamp ?? null,
        execution.status,
        next.failureCode ?? null,
        next.runId,
        execution.nodeExecutionId,
      )
  }

  const active = [...next.executions]
    .reverse()
    .find(({ status }) => status === 'PENDING' || status === 'RUNNING')
  const completedAt = next.status === 'RUNNING' ? null : (next.events.at(-1)?.timestamp ?? null)
  connection
    .prepare(
      `UPDATE runs
       SET status = ?, current_node_id = ?, transition_count = ?,
           started_at = COALESCE(started_at, ?), completed_at = ?
       WHERE run_id = ?`,
    )
    .run(
      next.status,
      active?.nodeId ?? null,
      next.transitionCount,
      next.events[0]?.timestamp ?? null,
      completedAt,
      next.runId,
    )

  const newEvents = next.events.slice(previous?.events.length ?? 0)
  const runId = RunIdSchema.parse(next.runId)
  for (const event of newEvents) {
    const execution =
      messageNodeExecutionId === undefined
        ? undefined
        : next.executions.find(({ nodeExecutionId }) => nodeExecutionId === messageNodeExecutionId)
    if (event.type === 'RUN_STARTED') {
      if (previous === undefined)
        appendEvent(connection, runId, {
          type: 'RUN_STATUS_CHANGED',
          timestamp: event.timestamp,
          data: { from: 'PENDING', to: 'RUNNING' },
        })
    } else if (event.type === 'RUN_CANCEL_REQUESTED') {
      appendEvent(connection, runId, {
        type: 'RUN_CANCEL_REQUESTED',
        timestamp: event.timestamp,
        data: event.data as { reason?: string },
      })
    } else if (event.type === 'NODE_STARTED' && execution !== undefined) {
      appendEvent(
        connection,
        runId,
        {
          type: 'NODE_STARTED',
          nodeId: NodeIdSchema.parse(execution.nodeId),
          timestamp: event.timestamp,
          data: event.data as never,
        },
        execution.nodeExecutionId,
      )
    } else if (event.type === 'NODE_COMPLETED' && execution !== undefined) {
      appendEvent(
        connection,
        runId,
        {
          type: 'NODE_COMPLETED',
          nodeId: NodeIdSchema.parse(execution.nodeId),
          timestamp: event.timestamp,
          data: event.data as never,
        },
        execution.nodeExecutionId,
      )
    } else if (
      (event.type === 'NODE_FAILED' || event.type === 'NODE_CANCELLED') &&
      execution !== undefined
    ) {
      appendEvent(
        connection,
        runId,
        {
          type: 'NODE_FAILED',
          nodeId: NodeIdSchema.parse(execution.nodeId),
          timestamp: event.timestamp,
          data: event.data as never,
        },
        execution.nodeExecutionId,
      )
    } else if (execution !== undefined && event.type !== 'JOB_SCHEDULED') {
      const content = JSON.stringify({ eventType: event.type, data: event.data })
      appendEvent(
        connection,
        runId,
        {
          type: 'NODE_OUTPUT',
          nodeId: NodeIdSchema.parse(execution.nodeId),
          timestamp: event.timestamp,
          data: { channel: 'agent', content },
        },
        execution.nodeExecutionId,
      )
    }
  }
  if (previous?.status === 'RUNNING' && next.status !== 'RUNNING') {
    appendEvent(connection, runId, {
      type: 'RUN_COMPLETED',
      timestamp: next.events.at(-1)?.timestamp ?? new Date().toISOString(),
      data: {
        status: next.status,
        durationMs: Math.max(
          0,
          Date.parse(next.events.at(-1)?.timestamp ?? '') -
            Date.parse(next.events[0]?.timestamp ?? ''),
        ),
      },
    })
  }
}

export const createSqliteCoordinatorStateStore = (
  database: WorkbenchDatabase,
): CoordinatorStateStore => {
  const connection = getDatabaseHandle(database)
  const create = (state: CoordinatorRunState, commands: readonly NewExecutionMessage[]) => {
    connection
      .transaction(() => {
        connection
          .prepare(
            `INSERT INTO workflow_coordinator_states (run_id, state_json, updated_at)
             VALUES (?, ?, ?)`,
          )
          .run(state.runId, serializeState(state), state.events.at(-1)?.timestamp)
        syncState(connection, undefined, state)
        for (const command of commands) insertMessage(connection, command)
      })
      .immediate()
  }
  return {
    create(state) {
      create(state, [])
    },
    createWithCommands: create,
    get(runId) {
      return readState(connection, runId)
    },
    update(runId, update) {
      return connection
        .transaction(() => {
          const previous = readState(connection, runId)
          if (previous === undefined) throw new Error('Coordinator run was not found')
          const next = CoordinatorRunStateSchema.parse(update(previous))
          connection
            .prepare(
              `UPDATE workflow_coordinator_states SET state_json = ?, updated_at = ? WHERE run_id = ?`,
            )
            .run(serializeState(next), next.events.at(-1)?.timestamp, runId)
          syncState(connection, previous, next)
          return next
        })
        .immediate()
    },
    updateAndCompleteClaim(input) {
      return connection
        .transaction(() => {
          const previous = readState(connection, input.runId)
          if (previous === undefined) throw new Error('Coordinator run was not found')
          const result = input.update(previous)
          const next = CoordinatorRunStateSchema.parse(result.state)
          const claim = connection
            .prepare(
              `UPDATE execution_messages
               SET status = 'PROCESSED', processed_at = ?, lease_expires_at = NULL
               WHERE id = ? AND destination = 'COORDINATOR'
                 AND status = 'CLAIMED' AND claimed_by = ?`,
            )
            .run(input.processedAt, input.message.id, input.consumerId)
          if (claim.changes !== 1) throw new Error('Coordinator message claim is not owned')
          connection
            .prepare(
              `UPDATE workflow_coordinator_states SET state_json = ?, updated_at = ? WHERE run_id = ?`,
            )
            .run(serializeState(next), input.processedAt, input.runId)
          syncState(connection, previous, next, input.message.nodeExecutionId)
          for (const command of result.commands) insertMessage(connection, command)
          return next
        })
        .immediate()
    },
  }
}
