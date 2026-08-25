import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { RunIdSchema, RunStatusSchema, type RunStatus } from '@slopify/contracts'
import { WorkflowSlugSchema } from '@slopify/workflow-model'

import {
  createAtomicJsonResourceIO,
  type AtomicJsonResourceIO,
} from '../filesystem/atomic-json-resource.js'
import type { SlopifyPaths } from '../filesystem/slopify-home.js'
import type { ListRunsInput } from '../persistence/run-repository.js'
import { createFilesystemRunJournal } from './filesystem-run-journal.js'
import {
  RunProjectionSchema,
  RunRepositoriesSnapshotSchema,
  RunVariablesSnapshotSchema,
  RunWorkflowSnapshotSchema,
  type RunProjection,
  type RunRepositoriesSnapshot,
  type RunVariablesSnapshot,
  type RunWorkflowSnapshot,
  type RunWorkspacesProjection,
  type NodeExecutionProjection,
} from './run-artifacts.js'
import type { RunDomainEvent } from './run-events.js'

export interface FilesystemRunLocator {
  readonly workflowId: string
  readonly runId: string
}

export interface FilesystemRunDiagnostic {
  readonly code: string
  readonly message: string
}

export type FilesystemRunIndexEntry =
  | Readonly<{
      status: 'READY'
      locator: FilesystemRunLocator
      run: RunProjection
    }>
  | Readonly<{
      status: 'CORRUPT'
      locator: FilesystemRunLocator
      diagnostic: FilesystemRunDiagnostic
    }>

export interface FilesystemRunIndexPage {
  readonly data: readonly FilesystemRunIndexEntry[]
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly totalItems: number
    readonly totalPages: number
  }
}

export interface FilesystemRunIndex {
  refresh(): Promise<void>
  get(runId: string): Promise<FilesystemRunIndexEntry | undefined>
  list(input: ListRunsInput): Promise<FilesystemRunIndexPage>
}

export type FilesystemRunDetail =
  | Readonly<{
      status: 'READY'
      run: RunProjection
      workflowSnapshot: RunWorkflowSnapshot
      variablesSnapshot: RunVariablesSnapshot
      repositoriesSnapshot: RunRepositoriesSnapshot
      workspaces: RunWorkspacesProjection
      executions: readonly NodeExecutionProjection[]
      events: readonly RunDomainEvent[]
    }>
  | Extract<FilesystemRunIndexEntry, { readonly status: 'CORRUPT' }>

export interface FilesystemRunReader {
  get(runId: string): Promise<FilesystemRunDetail | undefined>
}

interface CachedEntry {
  readonly signature: string
  readonly entry: FilesystemRunIndexEntry
}

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined

const diagnostic = (cause: unknown): FilesystemRunDiagnostic => ({
  code: errorCode(cause) ?? 'RUN_ARTIFACT_UNAVAILABLE',
  message: cause instanceof Error ? cause.message : 'Run artifact could not be read',
})

const listDirectories = async (path: string): Promise<readonly string[]> => {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch (cause) {
    if (errorCode(cause) === 'ENOENT') return []
    throw cause
  }
}

const fileSignature = async (path: string): Promise<string> => {
  try {
    const metadata = await lstat(path, { bigint: true })
    if (metadata.isSymbolicLink() || !metadata.isFile()) return 'invalid'
    return [metadata.dev, metadata.ino, metadata.size, metadata.mtimeNs, metadata.ctimeNs].join(':')
  } catch (cause) {
    if (errorCode(cause) === 'ENOENT') return 'missing'
    throw cause
  }
}

const duration = (run: RunProjection): number | null => {
  if (run.startedAt === null || run.completedAt === null) return null
  return Math.max(0, Math.round(Date.parse(run.completedAt) - Date.parse(run.startedAt)))
}

const validatesPagination = (input: ListRunsInput): void => {
  if (
    !Number.isSafeInteger(input.page) ||
    input.page < 1 ||
    !Number.isSafeInteger(input.pageSize) ||
    input.pageSize < 1 ||
    input.pageSize > 100
  ) {
    throw new TypeError('Run pagination is outside the supported range')
  }
}

export const createFilesystemRunIndex = (
  options: Readonly<{
    paths: Pick<SlopifyPaths, 'workflowsDirectory' | 'run'>
    resources?: AtomicJsonResourceIO
  }>,
): FilesystemRunIndex => {
  const resources = options.resources ?? createAtomicJsonResourceIO()
  let cache = new Map<string, CachedEntry>()

  const refresh = async (): Promise<void> => {
    const next = new Map<string, CachedEntry>()
    for (const workflowIdInput of await listDirectories(options.paths.workflowsDirectory)) {
      const parsedWorkflowId = WorkflowSlugSchema.safeParse(workflowIdInput)
      if (!parsedWorkflowId.success) continue
      const workflowId = parsedWorkflowId.data
      const runsDirectory = join(options.paths.workflowsDirectory, workflowId, 'runs')
      for (const runIdInput of await listDirectories(runsDirectory)) {
        const parsedRunId = RunIdSchema.safeParse(runIdInput)
        if (!parsedRunId.success) continue
        const runId = parsedRunId.data
        const locator = { workflowId, runId }
        const runFile = options.paths.run(workflowId, runId).runFile
        const signature = await fileSignature(runFile)
        const key = `${workflowId}/${runId}`
        const existing = cache.get(key)
        if (existing?.signature === signature) {
          next.set(key, existing)
          continue
        }
        let entry: FilesystemRunIndexEntry
        try {
          const run = await resources.read({ path: runFile, schema: RunProjectionSchema })
          if (run.runId !== runId || run.workflowId !== workflowId) {
            throw new TypeError('Run projection does not match its filesystem location')
          }
          entry = { status: 'READY', locator, run }
        } catch (cause) {
          entry = { status: 'CORRUPT', locator, diagnostic: diagnostic(cause) }
        }
        next.set(key, { signature, entry })
      }
    }
    cache = next
  }

  const entries = (): readonly FilesystemRunIndexEntry[] =>
    [...cache.values()].map(({ entry }) => entry)

  return {
    refresh,
    async get(runIdInput) {
      const runId = RunIdSchema.parse(runIdInput)
      await refresh()
      return entries().find(({ locator }) => locator.runId === runId)
    },
    async list(input) {
      validatesPagination(input)
      const statuses: readonly RunStatus[] | undefined = input.statuses?.map((status) =>
        RunStatusSchema.parse(status),
      )
      await refresh()
      const filtered = entries()
        .filter((entry) => input.runId === undefined || entry.locator.runId.includes(input.runId))
        .filter(
          (entry) =>
            statuses === undefined ||
            statuses.length === 0 ||
            (entry.status === 'READY' && statuses.includes(entry.run.status)),
        )
        .filter((entry) => {
          if (entry.status === 'CORRUPT') {
            return (
              input.startedFrom === undefined &&
              input.startedTo === undefined &&
              input.durationMinMs === undefined &&
              input.durationMaxMs === undefined
            )
          }
          const startedAt = entry.run.startedAt === null ? null : Date.parse(entry.run.startedAt)
          if (
            input.startedFrom !== undefined &&
            (startedAt === null || startedAt < Date.parse(input.startedFrom))
          )
            return false
          if (
            input.startedTo !== undefined &&
            (startedAt === null || startedAt > Date.parse(input.startedTo))
          )
            return false
          const durationMs = duration(entry.run)
          if (
            input.durationMinMs !== undefined &&
            (durationMs === null || durationMs < input.durationMinMs)
          )
            return false
          if (
            input.durationMaxMs !== undefined &&
            (durationMs === null || durationMs > input.durationMaxMs)
          )
            return false
          return true
        })
        .sort((left, right) => {
          if (left.status !== right.status) return left.status === 'READY' ? -1 : 1
          if (left.status === 'READY' && right.status === 'READY') {
            return (
              right.run.createdAt.localeCompare(left.run.createdAt) ||
              right.run.runId.localeCompare(left.run.runId)
            )
          }
          return right.locator.runId.localeCompare(left.locator.runId)
        })
      const start = (input.page - 1) * input.pageSize
      return {
        data: filtered.slice(start, start + input.pageSize),
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          totalItems: filtered.length,
          totalPages: Math.ceil(filtered.length / input.pageSize),
        },
      }
    },
  }
}

export const createFilesystemRunReader = (
  options: Readonly<{
    index: Pick<FilesystemRunIndex, 'get'>
    paths: Pick<SlopifyPaths, 'run'>
    resources?: AtomicJsonResourceIO
  }>,
): FilesystemRunReader => {
  const resources = options.resources ?? createAtomicJsonResourceIO()
  return {
    async get(runId) {
      const indexed = await options.index.get(runId)
      if (indexed === undefined || indexed.status === 'CORRUPT') return indexed
      const runPaths = options.paths.run(indexed.locator.workflowId, indexed.locator.runId)
      try {
        const journal = createFilesystemRunJournal({
          paths: options.paths,
          workflowId: indexed.locator.workflowId,
          runId: indexed.locator.runId,
          resources,
        })
        const [repaired, workflowSnapshot, variablesSnapshot, repositoriesSnapshot] =
          await Promise.all([
            journal.repairProjections(),
            resources.read({
              path: runPaths.workflowSnapshotFile,
              schema: RunWorkflowSnapshotSchema,
            }),
            resources.read({ path: runPaths.variablesFile, schema: RunVariablesSnapshotSchema }),
            resources.read({
              path: runPaths.repositoriesSnapshotFile,
              schema: RunRepositoriesSnapshotSchema,
            }),
          ])
        if (repaired.status === 'CORRUPT') {
          return { status: 'CORRUPT', locator: indexed.locator, diagnostic: repaired.diagnostic }
        }
        return {
          status: 'READY',
          run: repaired.projection.run,
          workflowSnapshot,
          variablesSnapshot,
          repositoriesSnapshot,
          workspaces: repaired.projection.workspaces,
          executions: repaired.projection.executions,
          events: repaired.events,
        }
      } catch (cause) {
        return { status: 'CORRUPT', locator: indexed.locator, diagnostic: diagnostic(cause) }
      }
    },
  }
}
