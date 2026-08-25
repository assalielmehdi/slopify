import {
  WorkflowFileSchema,
  WorkflowSlugSchema,
  createWorkflowDraft,
  workflowToWorkflowFile,
  type WorkflowFile,
} from '@slopify/workflow-model'
import { z } from 'zod'

import {
  HarnessCatalogError,
  type HarnessCatalog,
  type HarnessCatalogErrorCode,
} from '../harnesses/harness-catalog.js'
import { ResourceRevisionSchema, type ResourceRevision } from '../filesystem/resource-revision.js'
import { WorkflowStoreError, type WorkflowStore } from '../workflows/workflow-store.js'
import type { WorkflowDiagnostic, WorkflowSource } from '../workflows/workflow-source.js'
import { WorkflowServiceError } from './workflow-service.js'

const CreateWorkflowDefinitionInputSchema = z
  .strictObject({
    workflowId: WorkflowSlugSchema,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(4096),
  })
  .readonly()

const UpdateWorkflowDefinitionInputSchema = z
  .strictObject({
    value: WorkflowFileSchema,
    expectedRevision: ResourceRevisionSchema.nullable(),
  })
  .readonly()

export type WorkflowReadinessCode = 'WORKFLOW_EMPTY_GRAPH' | HarnessCatalogErrorCode

export interface WorkflowReadinessFinding {
  readonly code: WorkflowReadinessCode
  readonly message: string
  readonly path: readonly (string | number)[]
}

export type WorkflowDefinitionCatalogEntry =
  | Readonly<{
      status: 'VALID'
      workflowId: string
      value: WorkflowFile
      revision: ResourceRevision
      runnable: boolean
      readiness: readonly WorkflowReadinessFinding[]
    }>
  | Readonly<{
      status: 'INVALID'
      workflowId: string
      revision: ResourceRevision | null
      diagnostics: readonly WorkflowDiagnostic[]
    }>

export interface WorkflowDefinitionService {
  list(): Promise<readonly WorkflowDefinitionCatalogEntry[]>
  get(workflowId: string): Promise<WorkflowDefinitionCatalogEntry>
  getSource(workflowId: string): Promise<WorkflowSource>
  create(input: unknown): Promise<WorkflowDefinitionCatalogEntry>
  update(workflowId: string, input: unknown): Promise<WorkflowDefinitionCatalogEntry>
}

const readinessFinding = (
  code: WorkflowReadinessCode,
  message: string,
  path: readonly (string | number)[],
): WorkflowReadinessFinding => Object.freeze({ code, message, path: Object.freeze([...path]) })

const invalidCatalogEntry = (
  source: Extract<WorkflowSource, { readonly status: 'INVALID' }>,
): WorkflowDefinitionCatalogEntry =>
  Object.freeze({
    status: source.status,
    workflowId: source.workflowId,
    revision: source.revision,
    diagnostics: source.diagnostics,
  })

const mapStoreError = (cause: unknown): never => {
  if (cause instanceof WorkflowStoreError) {
    if (cause.code === 'WORKFLOW_CONFLICT') {
      throw new WorkflowServiceError('WORKFLOW_ID_CONFLICT', 'Workflow ID already exists')
    }
    if (cause.code === 'WORKFLOW_REVISION_CONFLICT') {
      throw new WorkflowServiceError(
        'WORKFLOW_REVISION_CONFLICT',
        'Workflow changed since it was read',
      )
    }
    if (cause.code === 'WORKFLOW_ID_MISMATCH') {
      throw new WorkflowServiceError(
        'WORKFLOW_ID_MISMATCH',
        'Workflow ID does not match the requested resource',
      )
    }
    if (cause.code === 'WORKFLOW_NOT_FOUND') {
      throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Workflow was not found')
    }
    if (cause.code === 'WORKFLOW_FILE_INVALID') {
      throw new WorkflowServiceError('WORKFLOW_FILE_INVALID', cause.message)
    }
    if (cause.code === 'WORKFLOW_UNAVAILABLE') {
      throw new WorkflowServiceError('WORKFLOW_UNAVAILABLE', 'Workflows are unavailable')
    }
  }
  throw cause
}

const useWorkflowStore = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
  try {
    return await operation()
  } catch (cause) {
    return mapStoreError(cause)
  }
}

export const createWorkflowDefinitionService = (options: {
  readonly workflows: WorkflowStore
  readonly harnesses: Pick<HarnessCatalog, 'requireAvailable'>
  readonly now?: () => string
}): WorkflowDefinitionService => {
  const now = options.now ?? (() => new Date().toISOString())

  const evaluate = async (
    workflowId: string,
    value: WorkflowFile,
    revision: ResourceRevision,
  ): Promise<WorkflowDefinitionCatalogEntry> => {
    const readiness: WorkflowReadinessFinding[] = []
    if (value.graph.nodes.length === 0) {
      readiness.push(
        readinessFinding(
          'WORKFLOW_EMPTY_GRAPH',
          'Add at least one agent before running this workflow',
          ['graph', 'nodes'],
        ),
      )
    } else {
      const nodeReadiness = await Promise.all(
        value.graph.nodes.map(async (node, nodeIndex) => {
          try {
            await options.harnesses.requireAvailable(
              node.harness.harnessId,
              node.harness.modelId,
              node.harness.thinkingLevel,
            )
            return undefined
          } catch (cause) {
            const path = ['graph', 'nodes', nodeIndex, 'harness', 'harnessId'] as const
            return cause instanceof HarnessCatalogError
              ? readinessFinding(cause.code, cause.message, path)
              : readinessFinding(
                  'HARNESS_UNAVAILABLE',
                  'The selected agent harness could not be inspected',
                  path,
                )
          }
        }),
      )
      readiness.push(
        ...nodeReadiness.filter(
          (finding): finding is WorkflowReadinessFinding => finding !== undefined,
        ),
      )
    }
    const frozenReadiness = Object.freeze(readiness)
    return Object.freeze({
      status: 'VALID',
      workflowId,
      value,
      revision,
      runnable: frozenReadiness.length === 0,
      readiness: frozenReadiness,
    })
  }

  const toCatalogEntry = async (source: WorkflowSource): Promise<WorkflowDefinitionCatalogEntry> =>
    source.status === 'INVALID'
      ? invalidCatalogEntry(source)
      : evaluate(source.workflowId, source.value, source.revision)

  const getSource = async (workflowIdInput: string): Promise<WorkflowSource> => {
    const workflowId = WorkflowSlugSchema.parse(workflowIdInput)
    const source = await useWorkflowStore(() => options.workflows.get(workflowId))
    if (source === undefined) {
      throw new WorkflowServiceError('WORKFLOW_NOT_FOUND', 'Workflow was not found')
    }
    return source
  }

  return {
    async list() {
      const sources = await useWorkflowStore(() => options.workflows.list())
      return Object.freeze(await Promise.all(sources.map(toCatalogEntry)))
    },

    async get(workflowId) {
      return toCatalogEntry(await getSource(workflowId))
    },

    getSource,

    async create(input) {
      const parsed = CreateWorkflowDefinitionInputSchema.parse(input)
      const timestamp = now()
      const workflow = workflowToWorkflowFile(
        createWorkflowDraft({
          workflowId: parsed.workflowId,
          name: parsed.name,
          description: parsed.description,
          configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
          createdAt: timestamp,
        }),
      )
      const created = await useWorkflowStore(() => options.workflows.create(workflow))
      return evaluate(workflow.workflowId, created.value, created.revision)
    },

    async update(workflowIdInput, input) {
      const workflowId = WorkflowSlugSchema.parse(workflowIdInput)
      const parsed = UpdateWorkflowDefinitionInputSchema.parse(input)
      if (parsed.value.workflowId !== workflowId) {
        throw new WorkflowServiceError(
          'WORKFLOW_ID_MISMATCH',
          'Workflow ID does not match the requested resource',
        )
      }
      const current = await getSource(workflowId)
      const workflow = WorkflowFileSchema.parse({
        ...parsed.value,
        workflowId,
        createdAt: current.status === 'VALID' ? current.value.createdAt : parsed.value.createdAt,
        updatedAt: now(),
      })
      const saved = await useWorkflowStore(() =>
        options.workflows.save({
          workflowId,
          value: workflow,
          expectedRevision: parsed.expectedRevision,
        }),
      )
      return evaluate(workflowId, saved.value, saved.revision)
    },
  }
}
