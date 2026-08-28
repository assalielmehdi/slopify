import { createHash } from 'node:crypto'

import { GitProviderSchema } from '@slopify/contracts'
import {
  WorkflowReadSchema,
  convertWorkflowV1,
  validateWorkflow,
  workflowToWorkflowFile,
} from '@slopify/workflow-model'
import { z } from 'zod'

import { createAtomicJsonResourceIO } from '../filesystem/atomic-json-resource.js'
import { calculateResourceRevision } from '../filesystem/resource-revision.js'
import { resolveSlopifyPaths } from '../filesystem/slopify-home.js'
import {
  RunRepositoriesSnapshotSchema,
  RunVariablesSnapshotSchema,
  RunWorkflowSnapshotSchema,
} from '../runs/run-artifacts.js'
import { createFilesystemRunJournal } from '../runs/filesystem-run-journal.js'
import { RunDomainEventSchema } from '../runs/run-events.js'
import type { NewRunDomainEvent } from '../runs/run-journal.js'
import { openLegacySqliteReader, type LegacyTerminalRun } from './legacy-sqlite-reader.js'
import {
  createLegacyMigrationReadSnapshot,
  LegacyMigrationError,
  type LegacyMigrationPreparation,
} from './migration-service.js'
import { createLegacyTraceConverter } from './trace-converter.js'

export interface LegacyRunConversionResult {
  readonly runs: number
  readonly nodes: number
  readonly traces: number
}

export interface LegacyRunConverter {
  convert(): Promise<LegacyRunConversionResult>
}

const variablesSchema = z.record(z.string().trim().min(1).max(128), z.json())

const id = (parts: readonly string[]): string =>
  `legacy-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24)}`

const duration = (node: LegacyTerminalRun['nodes'][number]): number => {
  if (node.durationMs !== null) return node.durationMs
  if (node.startedAt !== null && node.completedAt !== null)
    return Math.max(0, Date.parse(node.completedAt) - Date.parse(node.startedAt))
  return 0
}

const repositoryWebUrl = (provider: 'GITHUB' | 'GITLAB', fullName: string): string =>
  `https://${provider === 'GITHUB' ? 'github.com' : 'gitlab.com'}/${fullName}`

const normalizeWorkflow = (input: unknown) => {
  const envelope = input as { readonly schemaVersion?: unknown }
  const workflow =
    envelope?.schemaVersion === 1 ? convertWorkflowV1(input) : WorkflowReadSchema.parse(input)
  const validation = validateWorkflow(workflow)
  if (!validation.valid)
    throw new LegacyMigrationError('INVALID_DATABASE', 'A captured workflow graph is invalid.')
  return validation.workflow
}

const runEvents = (run: LegacyTerminalRun, workflow: ReturnType<typeof normalizeWorkflow>) => {
  const events: unknown[] = []
  const append = (event: unknown) => events.push(event)

  if (run.startedAt !== null) append({ type: 'RUN_STARTED', timestamp: run.startedAt, data: {} })
  for (const workspace of run.workspaces) {
    const branchName = workspace.branchName ?? `legacy/${run.runId}`
    append({
      type: 'WORKSPACE_PREPARING',
      timestamp: run.createdAt,
      data: {
        repositoryId: workspace.repositoryId,
        position: workspace.position,
        workspacePath: workspace.workspacePath,
        branchName,
      },
    })
    if (workspace.status === 'READY')
      append({
        type: 'WORKSPACE_READY',
        timestamp: workspace.preparedAt ?? workspace.updatedAt,
        data: { repositoryId: workspace.repositoryId },
      })
    if (workspace.status === 'FAILED')
      append({
        type: 'WORKSPACE_FAILED',
        timestamp: workspace.updatedAt,
        data: {
          repositoryId: workspace.repositoryId,
          errorMessage: workspace.errorMessage ?? 'Legacy workspace preparation failed.',
        },
      })
    if (workspace.status === 'CLEANED' || workspace.status === 'LEGACY')
      append({
        type: 'WORKSPACE_CLEANED',
        timestamp: workspace.cleanedAt ?? workspace.updatedAt,
        data: { repositoryId: workspace.repositoryId },
      })
  }

  for (const node of run.nodes) {
    const scheduledAt = node.startedAt ?? node.completedAt ?? run.startedAt ?? run.createdAt
    append({
      type: 'NODE_SCHEDULED',
      timestamp: scheduledAt,
      data: {
        nodeExecutionId: node.nodeExecutionId,
        attemptId: node.attemptId,
        nodeId: node.nodeId,
        executionIndex: node.executionIndex,
        causationId: id([run.runId, node.nodeExecutionId, 'schedule']),
      },
    })
    if (node.startedAt !== null)
      append({
        type: 'NODE_STARTED',
        timestamp: node.startedAt,
        data: { nodeExecutionId: node.nodeExecutionId, attemptId: node.attemptId },
      })
    if (node.status === 'SUCCEEDED') {
      append({
        type: 'NODE_SUCCEEDED',
        timestamp: node.completedAt ?? scheduledAt,
        data: {
          nodeExecutionId: node.nodeExecutionId,
          attemptId: node.attemptId,
          outcome: node.outcome ?? 'completed',
          output: node.output,
          durationMs: duration(node),
        },
      })
      for (const edge of workflow.edges.filter(
        (edge) => edge.sourceNodeId === node.nodeId && edge.outcome === node.outcome,
      ))
        append({
          type: 'ROUTE_TRAVERSED',
          timestamp: node.completedAt ?? scheduledAt,
          data: {
            sourceNodeExecutionId: node.nodeExecutionId,
            sourceNodeId: node.nodeId,
            targetNodeId: edge.targetNodeId,
            outcome: edge.outcome,
          },
        })
    }
    if (node.status === 'FAILED')
      append({
        type: 'NODE_FAILED',
        timestamp: node.completedAt ?? scheduledAt,
        data: {
          nodeExecutionId: node.nodeExecutionId,
          attemptId: node.attemptId,
          code: node.errorCode ?? 'LEGACY_NODE_FAILED',
          message: node.errorMessage ?? 'Legacy node execution failed.',
          durationMs: duration(node),
        },
      })
    if (node.status === 'CANCELLED')
      append({
        type: 'NODE_CANCELLED',
        timestamp: node.completedAt ?? scheduledAt,
        data: {
          nodeExecutionId: node.nodeExecutionId,
          attemptId: node.attemptId,
          reason: node.errorMessage ?? 'Legacy node execution was cancelled.',
          durationMs: duration(node),
        },
      })
  }

  const completedAt =
    run.completedAt ?? run.nodes.toReversed().find((node) => node.completedAt !== null)?.completedAt
  if (completedAt === null || completedAt === undefined)
    throw new LegacyMigrationError(
      'INVALID_DATABASE',
      'A terminal legacy run has no completion timestamp.',
    )
  if (run.status === 'SUCCEEDED')
    append({ type: 'RUN_SUCCEEDED', timestamp: completedAt, data: {} })
  if (run.status === 'FAILED')
    append({
      type: 'RUN_FAILED',
      timestamp: completedAt,
      data: {
        code:
          run.nodes.toReversed().find((node) => node.errorCode !== null)?.errorCode ??
          'LEGACY_RUN_FAILED',
      },
    })
  if (run.status === 'CANCELLED') {
    if (run.cancelReason !== null)
      append({
        type: 'RUN_CANCEL_REQUESTED',
        timestamp: completedAt,
        data: { reason: run.cancelReason },
      })
    append({ type: 'RUN_CANCELLED', timestamp: completedAt, data: {} })
  }
  return events.map((event, index) => {
    const parsed = RunDomainEventSchema.parse({
      ...(event as Record<string, unknown>),
      schemaVersion: 1,
      eventId: `legacy-${String(index + 1).padStart(6, '0')}`,
      runId: run.runId,
      sequence: index + 1,
    })
    return {
      eventId: parsed.eventId,
      timestamp: parsed.timestamp,
      type: parsed.type,
      data: parsed.data,
    } as NewRunDomainEvent
  })
}

export const createLegacyRunConverter = (options: {
  readonly preparation: LegacyMigrationPreparation
  readonly legacyTracesRoot: string
}): LegacyRunConverter => ({
  async convert() {
    let runs
    const snapshot = await createLegacyMigrationReadSnapshot(options.preparation)
    try {
      const hasWalFrames = snapshot.manifest.sidecars.some(
        (sidecar) => sidecar.kind === 'WAL' && sidecar.backup.sizeBytes > 0,
      )
      const reader = await openLegacySqliteReader(snapshot.databasePath, {
        immutable: !hasWalFrames,
      })
      try {
        runs = reader.readTerminalRuns()
      } finally {
        reader.close()
      }
    } finally {
      await snapshot.cleanup()
    }

    const paths = resolveSlopifyPaths({
      environment: { SLOPIFY_HOME: options.preparation.exportDirectory },
    })
    const resources = createAtomicJsonResourceIO()
    const traces = createLegacyTraceConverter({
      legacyTracesRoot: options.legacyTracesRoot,
      paths,
    })
    let nodeCount = 0
    let traceCount = 0

    for (const run of runs) {
      const workflow = normalizeWorkflow(run.workflowSnapshot)
      if (workflow.workflowId !== run.workflowId)
        throw new LegacyMigrationError(
          'INVALID_DATABASE',
          'A legacy run does not match its captured workflow ID.',
        )
      const workflowFile = workflowToWorkflowFile(workflow)
      const workflowSource = `${JSON.stringify(workflowFile, null, 2)}\n`
      const runPaths = paths.run(workflowFile.workflowId, run.runId)
      await resources.write({
        path: runPaths.workflowSnapshotFile,
        schema: RunWorkflowSnapshotSchema,
        value: {
          schemaVersion: 1,
          capturedAt: run.createdAt,
          workflowRevision: calculateResourceRevision(workflowSource),
          workflow: workflowFile,
        },
      })
      await resources.write({
        path: runPaths.variablesFile,
        schema: RunVariablesSnapshotSchema,
        value: { schemaVersion: 1, values: variablesSchema.parse(run.variables) },
      })
      await resources.write({
        path: runPaths.repositoriesSnapshotFile,
        schema: RunRepositoriesSnapshotSchema,
        value: {
          schemaVersion: 1,
          repositories: run.repositories.map((repository) => {
            const provider = GitProviderSchema.parse(repository.provider)
            if (repository.remoteId === null || repository.defaultBranch === null)
              throw new LegacyMigrationError(
                'INVALID_DATABASE',
                'A captured legacy repository lacks remote identity.',
              )
            return {
              repositoryId: repository.repositoryId,
              position: repository.position,
              name: repository.name,
              provider,
              remoteId: repository.remoteId,
              fullName: repository.fullName,
              cloneUrl: repository.cloneUrl,
              webUrl: repositoryWebUrl(provider, repository.fullName),
              defaultBranch: repository.defaultBranch,
              baseSha: repository.baseSha,
              isPrimary: repository.isPrimary,
            }
          }),
        },
      })

      const journal = createFilesystemRunJournal({
        paths,
        workflowId: workflowFile.workflowId,
        runId: run.runId,
        resources,
      })
      for (const event of runEvents(run, workflow)) await journal.append(event)
      const repaired = await journal.repairProjections()
      if (
        repaired.status === 'CORRUPT' ||
        repaired.projection.run.status !== run.status ||
        repaired.projection.run.transitionCount !== run.transitionCount ||
        repaired.projection.executions.length !== run.nodes.length
      )
        throw new LegacyMigrationError(
          'INVALID_DATABASE',
          'A legacy run could not be reproduced by the filesystem journal.',
        )

      nodeCount += run.nodes.length
      for (const node of run.nodes) {
        if (
          await traces.convert({
            workflowId: workflowFile.workflowId,
            runId: run.runId,
            nodeExecutionId: node.nodeExecutionId,
            attemptId: node.attemptId,
            executionIndex: node.executionIndex,
          })
        )
          traceCount += 1
      }
    }

    return { runs: runs.length, nodes: nodeCount, traces: traceCount }
  },
})
