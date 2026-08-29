import { lstat, mkdir, readdir, rename, rmdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  WorkflowFileSchema,
  WorkflowSlugSchema,
  validateWorkflow,
  workflowFileToWorkflow,
  type WorkflowFile,
} from '@slopify/shared'

import {
  createAtomicJsonResourceIO,
  type AtomicJsonResourceIO,
} from '../filesystem/atomic-json-resource.js'
import { FilesystemResourceError } from '../filesystem/filesystem-errors.js'
import { ResourceRevisionSchema } from '../filesystem/resource-revision.js'
import type { SlopifyPaths } from '../filesystem/slopify-home.js'
import {
  WorkflowStoreError,
  type WorkflowStore,
  type WorkflowStoreEntry,
} from './workflow-store.js'
import {
  invalidWorkflowSource,
  parseWorkflowSource,
  workflowDiagnostic,
} from './workflow-source.js'

const MAX_WORKFLOW_BYTES = 1_048_576

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined

const resourceDiagnostics = (
  workflowId: string,
  cause: FilesystemResourceError,
): WorkflowStoreEntry => {
  if (cause.code === 'RESOURCE_NOT_FOUND') {
    return invalidWorkflowSource({
      workflowId,
      source: null,
      revision: null,
      diagnostics: [
        workflowDiagnostic('WORKFLOW_FILE_MISSING', 'Workflow definition file is missing'),
      ],
    })
  }
  if (
    cause.code === 'RESOURCE_TOO_LARGE' ||
    cause.code === 'RESOURCE_SYMLINK_NOT_ALLOWED' ||
    cause.code === 'RESOURCE_NOT_FILE'
  ) {
    return invalidWorkflowSource({
      workflowId,
      source: null,
      revision: null,
      diagnostics: [
        workflowDiagnostic('WORKFLOW_FILE_INVALID', 'Workflow definition file is invalid'),
      ],
    })
  }
  return invalidWorkflowSource({
    workflowId,
    source: null,
    revision: null,
    diagnostics: [
      workflowDiagnostic('WORKFLOW_ENTRY_UNAVAILABLE', 'Workflow definition could not be read'),
    ],
  })
}

const validateForStorage = (input: unknown): WorkflowFile => {
  const workflow = WorkflowFileSchema.parse(input)
  const result = validateWorkflow(workflowFileToWorkflow(workflow))
  if (!result.valid) {
    throw new WorkflowStoreError(
      'WORKFLOW_FILE_INVALID',
      result.findings.map(({ message }) => message).join(' '),
    )
  }
  return workflow
}

export const createFilesystemWorkflowStore = (
  options: Readonly<{
    paths: Pick<SlopifyPaths, 'archiveDirectory' | 'workflowsDirectory' | 'workflow'>
    resources?: AtomicJsonResourceIO
  }>,
): WorkflowStore => {
  const resources = options.resources ?? createAtomicJsonResourceIO()

  const inspectCatalogDirectory = async (missingAllowed: boolean): Promise<boolean> => {
    try {
      const metadata = await lstat(options.paths.workflowsDirectory)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new WorkflowStoreError(
          'WORKFLOW_UNAVAILABLE',
          'Workflow catalog must be a regular directory',
        )
      }
      return true
    } catch (cause) {
      if (cause instanceof WorkflowStoreError) throw cause
      if (missingAllowed && errorCode(cause) === 'ENOENT') return false
      throw new WorkflowStoreError(
        'WORKFLOW_UNAVAILABLE',
        'Workflow catalog could not be inspected',
        cause,
      )
    }
  }

  const nextArchiveDirectory = async (workflowId: string): Promise<string> => {
    try {
      await mkdir(options.paths.archiveDirectory, { recursive: true, mode: 0o700 })
      const metadata = await lstat(options.paths.archiveDirectory)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new WorkflowStoreError(
          'WORKFLOW_UNAVAILABLE',
          'Workflow archive must be a regular directory',
        )
      }
    } catch (cause) {
      if (cause instanceof WorkflowStoreError) throw cause
      throw new WorkflowStoreError(
        'WORKFLOW_UNAVAILABLE',
        'Workflow archive could not be prepared',
        cause,
      )
    }

    for (let sequence = 1; ; sequence += 1) {
      const name = sequence === 1 ? workflowId : `${workflowId}-${sequence}`
      const candidate = join(options.paths.archiveDirectory, name)
      try {
        await lstat(candidate)
      } catch (cause) {
        if (errorCode(cause) === 'ENOENT') return candidate
        throw new WorkflowStoreError(
          'WORKFLOW_UNAVAILABLE',
          'Workflow archive could not be inspected',
          cause,
        )
      }
    }
  }

  const readEntry = async (workflowId: string): Promise<WorkflowStoreEntry | undefined> => {
    const parsedId = WorkflowSlugSchema.safeParse(workflowId)
    if (!parsedId.success) {
      return invalidWorkflowSource({
        workflowId,
        source: null,
        revision: null,
        diagnostics: [
          workflowDiagnostic(
            'WORKFLOW_DIRECTORY_INVALID',
            'Workflow directory name must use 1–64 lowercase letters, numbers, and single hyphens',
          ),
        ],
      })
    }
    const paths = options.paths.workflow(parsedId.data)
    try {
      const metadata = await lstat(paths.directory)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        return invalidWorkflowSource({
          workflowId,
          source: null,
          revision: null,
          diagnostics: [
            workflowDiagnostic(
              'WORKFLOW_DIRECTORY_INVALID',
              'Workflow entry must be a regular directory',
            ),
          ],
        })
      }
    } catch (cause) {
      if (errorCode(cause) === 'ENOENT') return undefined
      return invalidWorkflowSource({
        workflowId,
        source: null,
        revision: null,
        diagnostics: [
          workflowDiagnostic(
            'WORKFLOW_ENTRY_UNAVAILABLE',
            'Workflow directory could not be inspected',
          ),
        ],
      })
    }

    let stored
    try {
      stored = await resources.readSource({
        path: paths.definitionFile,
        maxBytes: MAX_WORKFLOW_BYTES,
      })
    } catch (cause) {
      return cause instanceof FilesystemResourceError
        ? resourceDiagnostics(workflowId, cause)
        : invalidWorkflowSource({
            workflowId,
            source: null,
            revision: null,
            diagnostics: [
              workflowDiagnostic(
                'WORKFLOW_ENTRY_UNAVAILABLE',
                'Workflow definition could not be read',
              ),
            ],
          })
    }
    return parseWorkflowSource({ workflowId, ...stored })
  }

  return {
    async create(input) {
      let workflow: WorkflowFile
      try {
        workflow = validateForStorage(input)
      } catch (cause) {
        if (cause instanceof WorkflowStoreError) throw cause
        throw new WorkflowStoreError(
          'WORKFLOW_FILE_INVALID',
          'Workflow definition is invalid',
          cause,
        )
      }
      const paths = options.paths.workflow(workflow.workflowId)
      try {
        await mkdir(options.paths.workflowsDirectory, { recursive: true, mode: 0o700 })
      } catch (cause) {
        throw new WorkflowStoreError(
          'WORKFLOW_UNAVAILABLE',
          'Workflow catalog could not be created',
          cause,
        )
      }
      await inspectCatalogDirectory(false)
      try {
        await mkdir(paths.directory, { mode: 0o700 })
      } catch (cause) {
        if (errorCode(cause) === 'EEXIST') {
          throw new WorkflowStoreError('WORKFLOW_CONFLICT', 'Workflow already exists', cause)
        }
        throw new WorkflowStoreError('WORKFLOW_UNAVAILABLE', 'Workflow could not be created', cause)
      }
      try {
        return await resources.writeVersioned({
          path: paths.definitionFile,
          schema: WorkflowFileSchema,
          value: workflow,
          expectedRevision: null,
          maxBytes: MAX_WORKFLOW_BYTES,
        })
      } catch (cause) {
        await rmdir(paths.directory).catch(() => undefined)
        throw new WorkflowStoreError('WORKFLOW_UNAVAILABLE', 'Workflow could not be created', cause)
      }
    },

    async delete(workflowIdInput) {
      const workflowId = WorkflowSlugSchema.parse(workflowIdInput)
      const paths = options.paths.workflow(workflowId)
      try {
        const metadata = await lstat(paths.directory)
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
          throw new WorkflowStoreError(
            'WORKFLOW_UNAVAILABLE',
            'Workflow entry must be a regular directory',
          )
        }
      } catch (cause) {
        if (cause instanceof WorkflowStoreError) throw cause
        if (errorCode(cause) === 'ENOENT') return false
        throw new WorkflowStoreError(
          'WORKFLOW_UNAVAILABLE',
          'Workflow directory could not be inspected',
          cause,
        )
      }
      const archiveDirectory = await nextArchiveDirectory(workflowId)
      try {
        await rename(paths.directory, archiveDirectory)
      } catch (cause) {
        if (errorCode(cause) === 'ENOENT') return false
        throw new WorkflowStoreError(
          'WORKFLOW_UNAVAILABLE',
          'Workflow directory could not be archived',
          cause,
        )
      }
      return true
    },

    async get(workflowIdInput) {
      const workflowId = WorkflowSlugSchema.parse(workflowIdInput)
      return readEntry(workflowId)
    },

    async save(input) {
      const workflowId = WorkflowSlugSchema.parse(input.workflowId)
      const expectedRevision =
        input.expectedRevision === null
          ? null
          : ResourceRevisionSchema.parse(input.expectedRevision)
      let workflow: WorkflowFile
      try {
        workflow = validateForStorage(input.value)
      } catch (cause) {
        if (cause instanceof WorkflowStoreError) throw cause
        throw new WorkflowStoreError(
          'WORKFLOW_FILE_INVALID',
          'Workflow definition is invalid',
          cause,
        )
      }
      if (workflow.workflowId !== workflowId) {
        throw new WorkflowStoreError(
          'WORKFLOW_ID_MISMATCH',
          'Workflow ID does not match the requested resource',
        )
      }
      const current = await readEntry(workflowId)
      if (current === undefined) {
        throw new WorkflowStoreError('WORKFLOW_NOT_FOUND', 'Workflow was not found')
      }
      if (
        current.status === 'INVALID' &&
        current.diagnostics.some(
          ({ code }) =>
            code === 'WORKFLOW_DIRECTORY_INVALID' || code === 'WORKFLOW_ENTRY_UNAVAILABLE',
        )
      ) {
        throw new WorkflowStoreError('WORKFLOW_UNAVAILABLE', 'Workflow is unavailable')
      }
      try {
        return await resources.writeVersioned({
          path: options.paths.workflow(workflowId).definitionFile,
          schema: WorkflowFileSchema,
          value: workflow,
          expectedRevision,
          maxBytes: MAX_WORKFLOW_BYTES,
        })
      } catch (cause) {
        if (
          cause instanceof FilesystemResourceError &&
          cause.code === 'RESOURCE_REVISION_CONFLICT'
        ) {
          throw new WorkflowStoreError(
            'WORKFLOW_REVISION_CONFLICT',
            'Workflow changed since it was read',
            cause,
          )
        }
        throw new WorkflowStoreError('WORKFLOW_UNAVAILABLE', 'Workflow could not be saved', cause)
      }
    },

    async list() {
      if (!(await inspectCatalogDirectory(true))) return []
      let entries
      try {
        entries = await readdir(options.paths.workflowsDirectory, { withFileTypes: true })
      } catch (cause) {
        if (errorCode(cause) === 'ENOENT') return []
        throw new WorkflowStoreError('WORKFLOW_UNAVAILABLE', 'Workflows are unavailable', cause)
      }
      const results: WorkflowStoreEntry[] = []
      for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory()) {
          results.push(
            invalidWorkflowSource({
              workflowId: entry.name,
              source: null,
              revision: null,
              diagnostics: [
                workflowDiagnostic(
                  'WORKFLOW_DIRECTORY_INVALID',
                  'Workflow entry must be a regular directory',
                ),
              ],
            }),
          )
          continue
        }
        const stored = await readEntry(entry.name)
        if (stored !== undefined) results.push(stored)
      }
      return Object.freeze(results)
    },
  }
}
