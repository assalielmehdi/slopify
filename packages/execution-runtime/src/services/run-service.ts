import {
  CreateRunRequestSchema,
  RunIdSchema,
  WorkflowIdSchema,
  type CreateRunRequest,
  type GitSha,
  type GitProvider,
  type RepositoryId,
  type RunId,
} from '@slopify/contracts'
import { WorkflowSchema, validateWorkflow, workflowFileToWorkflow } from '@slopify/workflow-model'

import type { EventStore } from '../events/event-store.js'
import type { HarnessCatalog } from '../harnesses/harness-catalog.js'
import type { JsonValue } from '../persistence/json.js'
import type {
  NodeExecutionRecord,
  ListRunsInput,
  RunRepositorySnapshot,
  RunRepositoryWorkspace,
  RunRecord,
  RunRepository,
} from '../persistence/run-repository.js'
import type { FilesystemRunStore } from '../runs/filesystem-run-store.js'
import type { RunProjection } from '../runs/run-artifacts.js'
import type { WorkflowStore } from '../workflows/workflow-store.js'

export type RunServiceErrorCode =
  | 'RUN_ADMISSION_CLOSED'
  | 'RUN_NOT_FOUND'
  | 'RUN_REQUEST_INVALID'
  | 'RUN_VARIABLES_INVALID'
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_HARNESS_UNAVAILABLE'
  | 'WORKFLOW_CHANGED_DURING_ADMISSION'
  | 'WORKFLOW_REPOSITORY_UNAVAILABLE'
  | 'WORKFLOW_NOT_RUNNABLE'

export class RunServiceError extends Error {
  override readonly name = 'RunServiceError'

  constructor(
    readonly code: RunServiceErrorCode,
    message: string,
    options?: Readonly<{ cause?: unknown }>,
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
  }
}

export type CreateRunServiceInput = CreateRunRequest

export interface RunDetail {
  readonly run: RunRecord
  readonly events: ReturnType<EventStore['list']>['events']
  readonly nodeExecutions: readonly NodeExecutionRecord[]
  readonly repositories: readonly RunRepositorySnapshot[]
  readonly repositoryWorkspaces: readonly RunRepositoryWorkspace[]
}

export interface RunSummary {
  readonly runId: RunId
  readonly workflowId: string
  readonly status: RunRecord['status']
  readonly createdAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
  readonly durationMs: number | null
}

export interface RunSummaryPage {
  readonly data: readonly RunSummary[]
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly totalItems: number
    readonly totalPages: number
  }
}

export interface RunService {
  stopAdmissions(): void
  create(input: CreateRunServiceInput): Promise<RunRecord>
  get(runId: string): RunDetail | undefined
  list(input: ListRunsInput): RunSummaryPage
}

export interface CreateRunServiceOptions {
  readonly events: EventStore
  readonly runs: RunRepository
  readonly workflows: LegacyWorkflowCatalog
  readonly harnesses: Pick<HarnessCatalog, 'requireAvailable'>
  readonly resolveRepository: (repositoryId: string) => Promise<RunRepositoryResolution>
  readonly now?: () => string
  readonly createRunId?: () => string
}

export interface LegacyWorkflowCatalog {
  get(workflowId: string): import('@slopify/workflow-model').Workflow | undefined
}

export interface RunRepositoryResolution {
  readonly repositoryId: RepositoryId
  readonly name: string
  readonly provider: GitProvider
  readonly remoteId: string
  readonly fullName: string
  readonly cloneUrl: string
  readonly defaultBranch: string
  readonly baseSha: GitSha
}

export interface FilesystemRunRepositoryResolution extends RunRepositoryResolution {
  readonly webUrl: string
}

export interface FilesystemRunAdmissionService {
  stopAdmissions(): void
  create(input: CreateRunServiceInput): Promise<RunProjection>
}

export interface CreateFilesystemRunAdmissionServiceOptions {
  readonly runs: FilesystemRunStore
  readonly workflows: WorkflowStore
  readonly harnesses: Pick<HarnessCatalog, 'requireAvailable'>
  readonly resolveRepository: (repositoryId: string) => Promise<FilesystemRunRepositoryResolution>
  readonly now?: () => string
  readonly createRunId?: () => string
}

const cloneJson = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value

const duration = (run: RunRecord): number | null => {
  if (run.startedAt === null || run.completedAt === null) return null
  return Math.max(0, Date.parse(run.completedAt) - Date.parse(run.startedAt))
}

export const createFilesystemRunAdmissionService = (
  options: CreateFilesystemRunAdmissionServiceOptions,
): FilesystemRunAdmissionService => {
  const now = options.now ?? (() => new Date().toISOString())
  const createRunId = options.createRunId ?? (() => `run-${crypto.randomUUID()}`)
  let acceptingRuns = true

  const requireAdmissionsOpen = (): void => {
    if (!acceptingRuns) {
      throw new RunServiceError('RUN_ADMISSION_CLOSED', 'Run admissions are closed')
    }
  }

  return {
    stopAdmissions() {
      acceptingRuns = false
    },

    async create(input) {
      requireAdmissionsOpen()
      const parsed = CreateRunRequestSchema.parse(input)
      const workflowId = WorkflowIdSchema.parse(parsed.workflowId)
      const source = await options.workflows.get(workflowId)
      if (source === undefined) {
        throw new RunServiceError('WORKFLOW_NOT_FOUND', 'Workflow was not found')
      }
      if (source.status !== 'VALID') {
        throw new RunServiceError('WORKFLOW_NOT_RUNNABLE', 'Workflow is not runnable')
      }
      const workflow = workflowFileToWorkflow(source.value)
      const validation = validateWorkflow(workflow)
      if (
        !validation.valid ||
        workflow.startNodeId === null ||
        workflow.nodes.length === 0 ||
        workflow.configuration.repositoryIds.length === 0 ||
        workflow.configuration.primaryRepositoryId === null
      ) {
        throw new RunServiceError('WORKFLOW_NOT_RUNNABLE', 'Workflow is not runnable')
      }

      try {
        await Promise.all(
          workflow.nodes.map((node) =>
            options.harnesses.requireAvailable(
              node.harness.harnessId,
              node.harness.modelId,
              node.harness.thinkingLevel,
            ),
          ),
        )
      } catch {
        throw new RunServiceError(
          'WORKFLOW_HARNESS_UNAVAILABLE',
          'An agent harness or selected model is unavailable',
        )
      }

      let repositories: readonly FilesystemRunRepositoryResolution[]
      try {
        repositories = await Promise.all(
          workflow.configuration.repositoryIds.map((repositoryId) =>
            options.resolveRepository(repositoryId),
          ),
        )
        if (
          repositories.length !== workflow.configuration.repositoryIds.length ||
          repositories.some(
            (repository, index) =>
              repository.repositoryId !== workflow.configuration.repositoryIds[index],
          )
        ) {
          throw new Error('Repository resolution did not preserve workflow order')
        }
      } catch {
        throw new RunServiceError(
          'WORKFLOW_REPOSITORY_UNAVAILABLE',
          'A configured workflow repository is unavailable',
        )
      }

      const variables = cloneJson(parsed.variables ?? {})
      const configuredVariables = workflow.configuration.variables
      const suppliedVariables = Object.keys(variables)
      if (
        configuredVariables.length !== suppliedVariables.length ||
        configuredVariables.some((name) => !Object.hasOwn(variables, name))
      ) {
        throw new RunServiceError(
          'RUN_VARIABLES_INVALID',
          'Run variables must exactly match the workflow configuration',
        )
      }

      requireAdmissionsOpen()
      const capturedAt = now()
      const runId = RunIdSchema.parse(createRunId())
      return options.runs.admit({
        runId,
        workflowId,
        createdAt: capturedAt,
        workflowSnapshot: {
          schemaVersion: 1,
          capturedAt,
          workflowRevision: source.revision,
          workflow: cloneJson(source.value),
        },
        variablesSnapshot: { schemaVersion: 1, values: variables },
        repositoriesSnapshot: {
          schemaVersion: 1,
          repositories: repositories.map((repository, position) => ({
            ...repository,
            position,
            isPrimary: repository.repositoryId === workflow.configuration.primaryRepositoryId,
          })),
        },
        async verifySource() {
          const current = await options.workflows.get(workflowId)
          if (current?.status !== 'VALID' || current.revision !== source.revision) {
            throw new RunServiceError(
              'WORKFLOW_CHANGED_DURING_ADMISSION',
              'Workflow changed during run admission',
            )
          }
        },
      })
    },
  }
}

export const createRunService = (options: CreateRunServiceOptions): RunService => {
  const now = options.now ?? (() => new Date().toISOString())
  const createRunId = options.createRunId ?? (() => `run-${crypto.randomUUID()}`)
  let acceptingRuns = true

  const requireAdmissionsOpen = (): void => {
    if (!acceptingRuns) {
      throw new RunServiceError('RUN_ADMISSION_CLOSED', 'Run admissions are closed')
    }
  }

  return {
    stopAdmissions() {
      acceptingRuns = false
    },

    async create(input) {
      requireAdmissionsOpen()
      const parsed = CreateRunRequestSchema.parse(input)
      const workflowId = WorkflowIdSchema.parse(parsed.workflowId)
      const workflow = options.workflows.get(workflowId)
      if (workflow === undefined) {
        throw new RunServiceError('WORKFLOW_NOT_FOUND', 'Workflow was not found')
      }
      const validation = validateWorkflow(workflow)
      if (
        !validation.valid ||
        workflow.startNodeId === null ||
        workflow.nodes.length === 0 ||
        workflow.configuration.repositoryIds.length === 0 ||
        workflow.configuration.primaryRepositoryId === null
      ) {
        throw new RunServiceError('WORKFLOW_NOT_RUNNABLE', 'Workflow is not runnable')
      }

      try {
        await Promise.all(
          workflow.nodes.map((node) =>
            options.harnesses.requireAvailable(
              node.harness.harnessId,
              node.harness.modelId,
              node.harness.thinkingLevel,
            ),
          ),
        )
      } catch {
        throw new RunServiceError(
          'WORKFLOW_HARNESS_UNAVAILABLE',
          'An agent harness or selected model is unavailable',
        )
      }

      let repositories: readonly RunRepositoryResolution[]
      try {
        repositories = await Promise.all(
          workflow.configuration.repositoryIds.map((repositoryId) =>
            options.resolveRepository(repositoryId),
          ),
        )
        if (
          repositories.length !== workflow.configuration.repositoryIds.length ||
          repositories.some(
            (repository, index) =>
              repository.repositoryId !== workflow.configuration.repositoryIds[index],
          )
        ) {
          throw new Error('Repository resolution did not preserve workflow order')
        }
      } catch {
        throw new RunServiceError(
          'WORKFLOW_REPOSITORY_UNAVAILABLE',
          'A configured workflow repository is unavailable',
        )
      }

      const variables = cloneJson(parsed.variables ?? {}) as Readonly<Record<string, JsonValue>>
      const configuredVariables = workflow.configuration.variables
      const suppliedVariables = Object.keys(variables)
      if (
        configuredVariables.length !== suppliedVariables.length ||
        configuredVariables.some((name) => !Object.hasOwn(variables, name))
      ) {
        throw new RunServiceError(
          'RUN_VARIABLES_INVALID',
          'Run variables must exactly match the workflow configuration',
        )
      }

      requireAdmissionsOpen()
      const run = options.runs.create({
        runId: RunIdSchema.parse(createRunId()),
        workflowId,
        workflowSnapshot: WorkflowSchema.parse(cloneJson(validation.workflow)),
        variables,
        repositories,
        createdAt: now(),
      })
      return run
    },

    get(runIdInput) {
      const runId = RunIdSchema.parse(runIdInput)
      const run = options.runs.get(runId)
      if (run === undefined) return undefined
      const events = []
      let afterSequence = 0
      while (true) {
        const page = options.events.list({ runId, afterSequence, limit: 1_000 })
        events.push(...page.events)
        if (page.nextAfterSequence === null) break
        afterSequence = page.nextAfterSequence
      }
      return {
        run,
        events,
        nodeExecutions: options.runs.listNodeExecutions(runId),
        repositories: options.runs.listRunRepositories(runId),
        repositoryWorkspaces: options.runs.listRunRepositoryWorkspaces(runId),
      }
    },

    list(input) {
      const page = options.runs.list(input)
      return {
        pagination: page.pagination,
        data: page.data.map((run) => ({
          runId: run.runId,
          workflowId: run.workflowId,
          status: run.status,
          createdAt: run.createdAt,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          durationMs: duration(run),
        })),
      }
    },
  }
}
