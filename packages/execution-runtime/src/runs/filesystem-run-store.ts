import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { RunIdSchema } from '@slopify/contracts'
import { WorkflowSlugSchema } from '@slopify/workflow-model'

import {
  createAtomicJsonResourceIO,
  type AtomicJsonResourceIO,
} from '../filesystem/atomic-json-resource.js'
import type { SlopifyPaths, SlopifyRunPaths } from '../filesystem/slopify-home.js'
import {
  RunProjectionSchema,
  RunRepositoriesSnapshotSchema,
  RunVariablesSnapshotSchema,
  RunWorkflowSnapshotSchema,
  RunWorkspacesProjectionSchema,
  type RunProjection,
  type RunRepositoriesSnapshot,
  type RunVariablesSnapshot,
  type RunWorkflowSnapshot,
} from './run-artifacts.js'

export type FilesystemRunStoreErrorCode = 'RUN_CONFLICT' | 'RUN_DIRECTORY_INVALID'

export class FilesystemRunStoreError extends Error {
  override readonly name = 'FilesystemRunStoreError'

  constructor(
    readonly code: FilesystemRunStoreErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
  }
}

export interface FilesystemRunAdmissionInput {
  readonly runId: string
  readonly workflowId: string
  readonly createdAt: string
  readonly workflowSnapshot: RunWorkflowSnapshot
  readonly variablesSnapshot: RunVariablesSnapshot
  readonly repositoriesSnapshot: RunRepositoriesSnapshot
  readonly verifySource: () => Promise<void>
}

export interface FilesystemRunStore {
  admit(input: FilesystemRunAdmissionInput): Promise<RunProjection>
}

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined

const missing = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return false
  } catch (cause) {
    if (errorCode(cause) === 'ENOENT') return true
    throw cause
  }
}

const stagingPaths = (directory: string): SlopifyRunPaths => ({
  directory,
  runFile: join(directory, 'run.json'),
  workflowSnapshotFile: join(directory, 'workflow.snapshot.json'),
  variablesFile: join(directory, 'variables.json'),
  repositoriesSnapshotFile: join(directory, 'repositories.snapshot.json'),
  workspacesFile: join(directory, 'workspaces.json'),
  eventsFile: join(directory, 'events.jsonl'),
  nodesDirectory: join(directory, 'nodes'),
  workspacesDirectory: join(directory, 'workspaces'),
})

const createEmptyJournal = async (path: string): Promise<void> => {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

const syncDirectory = async (path: string): Promise<void> => {
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export const createFilesystemRunStore = (
  options: Readonly<{
    paths: Pick<SlopifyPaths, 'workflow' | 'run'>
    resources?: AtomicJsonResourceIO
  }>,
): FilesystemRunStore => {
  const resources = options.resources ?? createAtomicJsonResourceIO()

  return {
    async admit(input) {
      const runId = RunIdSchema.parse(input.runId)
      const workflowId = WorkflowSlugSchema.parse(input.workflowId)
      const workflowSnapshot = RunWorkflowSnapshotSchema.parse(input.workflowSnapshot)
      const variablesSnapshot = RunVariablesSnapshotSchema.parse(input.variablesSnapshot)
      const repositoriesSnapshot = RunRepositoriesSnapshotSchema.parse(input.repositoriesSnapshot)
      if (workflowSnapshot.workflow.workflowId !== workflowId) {
        throw new TypeError('Workflow snapshot does not match the run workflow')
      }

      const run = RunProjectionSchema.parse({
        schemaVersion: 1,
        runId,
        workflowId,
        status: 'PENDING',
        transitionCount: 0,
        lastEventSequence: 0,
        createdAt: input.createdAt,
        startedAt: null,
        completedAt: null,
        failureCode: null,
      })
      const workspaces = RunWorkspacesProjectionSchema.parse({
        schemaVersion: 1,
        runId,
        lastEventSequence: 0,
        workspaces: [],
      })

      const finalPaths = options.paths.run(workflowId, runId)
      const runsDirectory = options.paths.workflow(workflowId).runsDirectory
      await mkdir(runsDirectory, { recursive: true, mode: 0o700 })
      const runsMetadata = await lstat(runsDirectory)
      if (!runsMetadata.isDirectory() || runsMetadata.isSymbolicLink()) {
        throw new FilesystemRunStoreError(
          'RUN_DIRECTORY_INVALID',
          'Run catalog must be a regular directory',
        )
      }
      if (!(await missing(finalPaths.directory))) {
        throw new FilesystemRunStoreError('RUN_CONFLICT', 'Run already exists')
      }

      const temporaryDirectory = join(
        runsDirectory,
        `.${basename(finalPaths.directory)}.${process.pid}.${crypto.randomUUID()}.tmp`,
      )
      const staged = stagingPaths(temporaryDirectory)
      let committed = false
      try {
        await mkdir(staged.directory, { mode: 0o700 })
        await resources.write({
          path: staged.workflowSnapshotFile,
          schema: RunWorkflowSnapshotSchema,
          value: workflowSnapshot,
        })
        await resources.write({
          path: staged.variablesFile,
          schema: RunVariablesSnapshotSchema,
          value: variablesSnapshot,
        })
        await resources.write({
          path: staged.repositoriesSnapshotFile,
          schema: RunRepositoriesSnapshotSchema,
          value: repositoriesSnapshot,
        })
        await resources.write({ path: staged.runFile, schema: RunProjectionSchema, value: run })
        await resources.write({
          path: staged.workspacesFile,
          schema: RunWorkspacesProjectionSchema,
          value: workspaces,
        })
        await createEmptyJournal(staged.eventsFile)
        await mkdir(staged.nodesDirectory, { mode: 0o700 })
        await mkdir(staged.workspacesDirectory, { mode: 0o700 })
        await syncDirectory(staged.directory)

        await input.verifySource()
        if (!(await missing(finalPaths.directory))) {
          throw new FilesystemRunStoreError('RUN_CONFLICT', 'Run already exists')
        }
        await rename(staged.directory, finalPaths.directory)
        committed = true
        await syncDirectory(runsDirectory)
        return run
      } finally {
        if (!committed) await rm(staged.directory, { recursive: true, force: true })
      }
    },
  }
}
