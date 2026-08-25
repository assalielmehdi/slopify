import { workflowFileToWorkflow, type Workflow } from '@slopify/workflow-model'

import {
  createAtomicJsonResourceIO,
  type AtomicJsonResourceIO,
} from '../filesystem/atomic-json-resource.js'
import { FilesystemResourceError } from '../filesystem/filesystem-errors.js'
import type { SlopifyPaths } from '../filesystem/slopify-home.js'
import { createFilesystemRunJournal } from '../runs/filesystem-run-journal.js'
import { RunWorkflowSnapshotSchema } from '../runs/run-artifacts.js'
import type { RunJournal } from '../runs/run-journal.js'

export interface JournalCoordinatorRun {
  readonly workflow: Workflow
  readonly journal: RunJournal
}

export interface JournalCoordinatorStore {
  load(
    input: Readonly<{ workflowId: string; runId: string }>,
  ): Promise<JournalCoordinatorRun | undefined>
}

export const createFilesystemJournalCoordinatorStore = (
  options: Readonly<{
    paths: Pick<SlopifyPaths, 'run'>
    resources?: AtomicJsonResourceIO
  }>,
): JournalCoordinatorStore => {
  const resources = options.resources ?? createAtomicJsonResourceIO()
  return {
    async load(input) {
      const runPaths = options.paths.run(input.workflowId, input.runId)
      try {
        const snapshot = await resources.read({
          path: runPaths.workflowSnapshotFile,
          schema: RunWorkflowSnapshotSchema,
        })
        return {
          workflow: workflowFileToWorkflow(snapshot.workflow),
          journal: createFilesystemRunJournal({ ...input, paths: options.paths, resources }),
        }
      } catch (cause) {
        if (cause instanceof FilesystemResourceError && cause.code === 'RESOURCE_NOT_FOUND') {
          return undefined
        }
        throw cause
      }
    },
  }
}
