import { RunIdSchema } from '@slopify/contracts'
import { isDeepStrictEqual } from 'node:util'
import type { z } from 'zod'

import { AppendOnlyJsonlError, createAppendOnlyJsonl } from '../filesystem/append-only-jsonl.js'
import {
  createAtomicJsonResourceIO,
  type AtomicJsonResourceIO,
} from '../filesystem/atomic-json-resource.js'
import { FilesystemResourceError } from '../filesystem/filesystem-errors.js'
import type { SlopifyPaths } from '../filesystem/slopify-home.js'
import {
  NodeExecutionProjectionSchema,
  RunProjectionSchema,
  RunWorkflowSnapshotSchema,
  RunWorkspacesProjectionSchema,
} from './run-artifacts.js'
import { resolveNodeExecutionPaths } from './run-layout.js'
import { RunDomainEventSchema, type RunDomainEvent } from './run-events.js'
import { createRunProjectionState, reduceRunEvents, RunProjectionError } from './run-projection.js'
import {
  RunJournalError,
  type NewRunDomainEvent,
  type RunJournal,
  type RunJournalReplay,
  type RunProjectionRepair,
} from './run-journal.js'

const journalQueues = new Map<string, Promise<void>>()

const sameEvent = (existing: RunDomainEvent, candidate: NewRunDomainEvent): boolean =>
  existing.eventId === candidate.eventId &&
  existing.timestamp === candidate.timestamp &&
  existing.type === candidate.type &&
  isDeepStrictEqual(existing.data, candidate.data)

const matches = async <Value>(
  resources: AtomicJsonResourceIO,
  path: string,
  schema: z.ZodType<Value>,
  value: Value,
): Promise<boolean> => {
  try {
    const current = await resources.read({ path, schema })
    return JSON.stringify(current) === JSON.stringify(value)
  } catch (cause) {
    if (cause instanceof FilesystemResourceError) return false
    throw cause
  }
}

export const createFilesystemRunJournal = (
  options: Readonly<{
    paths: Pick<SlopifyPaths, 'run'>
    workflowId: string
    runId: string
    resources?: AtomicJsonResourceIO
  }>,
): RunJournal => {
  const runId = RunIdSchema.parse(options.runId)
  const runPaths = options.paths.run(options.workflowId, options.runId)
  const resources = options.resources ?? createAtomicJsonResourceIO()
  const events = createAppendOnlyJsonl({ path: runPaths.eventsFile, schema: RunDomainEventSchema })

  const enqueue = <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const previous = journalQueues.get(runPaths.eventsFile) ?? Promise.resolve()
    const result = previous.then(operation)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    journalQueues.set(runPaths.eventsFile, settled)
    void settled.then(() => {
      if (journalQueues.get(runPaths.eventsFile) === settled) {
        journalQueues.delete(runPaths.eventsFile)
      }
    })
    return result
  }

  const replay = async (): Promise<RunJournalReplay> => {
    try {
      const replayed = await events.replay()
      const eventIds = new Set<string>()
      for (const event of replayed.records) {
        if (eventIds.has(event.eventId)) {
          return {
            status: 'CORRUPT',
            diagnostic: {
              code: 'DUPLICATE_EVENT_ID',
              message: 'Run event IDs must be unique',
              lineNumber: event.sequence,
            },
          }
        }
        eventIds.add(event.eventId)
      }
      return {
        status: 'READY',
        events: replayed.records,
        recoveredBytes: replayed.recoveredBytes,
      }
    } catch (cause) {
      if (cause instanceof AppendOnlyJsonlError) {
        return {
          status: 'CORRUPT',
          diagnostic: {
            code: cause.code,
            message: cause.message,
            lineNumber: cause.lineNumber,
          },
        }
      }
      throw cause
    }
  }

  const repairProjections = async (): Promise<RunProjectionRepair> => {
    const replayed = await replay()
    if (replayed.status === 'CORRUPT') return replayed
    const workflowSnapshot = await resources.read({
      path: runPaths.workflowSnapshotFile,
      schema: RunWorkflowSnapshotSchema,
    })
    let projection = createRunProjectionState({
      run: RunProjectionSchema.parse({
        schemaVersion: 1,
        runId,
        workflowId: workflowSnapshot.workflow.workflowId,
        status: 'PENDING',
        transitionCount: 0,
        lastEventSequence: 0,
        createdAt: workflowSnapshot.capturedAt,
        startedAt: null,
        completedAt: null,
        failureCode: null,
      }),
      workspaces: RunWorkspacesProjectionSchema.parse({
        schemaVersion: 1,
        runId,
        lastEventSequence: 0,
        workspaces: [],
      }),
    })
    for (const event of replayed.events) {
      try {
        projection = reduceRunEvents(projection, [event])
      } catch (cause) {
        if (cause instanceof RunProjectionError) {
          return {
            status: 'CORRUPT',
            diagnostic: {
              code: 'EVENT_SEMANTICS_INVALID',
              message: cause.message,
              lineNumber: event.sequence,
            },
          }
        }
        throw cause
      }
    }

    let repaired = false
    for (const execution of projection.executions) {
      const path = resolveNodeExecutionPaths(
        runPaths,
        execution.executionIndex,
        execution.nodeExecutionId,
      ).executionFile
      if (!(await matches(resources, path, NodeExecutionProjectionSchema, execution))) {
        await resources.write({ path, schema: NodeExecutionProjectionSchema, value: execution })
        repaired = true
      }
    }
    if (
      !(await matches(
        resources,
        runPaths.workspacesFile,
        RunWorkspacesProjectionSchema,
        projection.workspaces,
      ))
    ) {
      await resources.write({
        path: runPaths.workspacesFile,
        schema: RunWorkspacesProjectionSchema,
        value: projection.workspaces,
      })
      repaired = true
    }
    if (!(await matches(resources, runPaths.runFile, RunProjectionSchema, projection.run))) {
      await resources.write({
        path: runPaths.runFile,
        schema: RunProjectionSchema,
        value: projection.run,
      })
      repaired = true
    }
    return { ...replayed, projection, repaired }
  }

  return {
    append(input) {
      return enqueue(async () => {
        const candidate = RunDomainEventSchema.parse({
          ...input,
          schemaVersion: 1,
          runId,
          sequence: 1,
        })
        const replayed = await replay()
        if (replayed.status === 'CORRUPT') {
          throw new RunJournalError('RUN_JOURNAL_CORRUPT', 'Run journal is corrupt')
        }
        const existing = replayed.events.find(({ eventId }) => eventId === candidate.eventId)
        if (existing !== undefined) {
          if (sameEvent(existing, candidate)) return existing
          throw new RunJournalError('RUN_EVENT_CONFLICT', 'Run event ID already exists')
        }
        return events.append({
          ...input,
          schemaVersion: 1,
          runId,
        })
      })
    },
    replay() {
      return enqueue(replay)
    },
    repairProjections() {
      return enqueue(repairProjections)
    },
  }
}
