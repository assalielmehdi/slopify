import {
  CreateRunRequestSchema,
  RunIdSchema,
  WorkflowIdSchema,
  type CreateRunRequest,
  type RunId,
} from '@slopify/contracts'
import {
  WorkflowSchema,
  findMissingPromptVariables,
  getWorkflowPromptVariableNames,
  validateWorkflow,
} from '@slopify/workflow-model'

import type { EventStore } from '../events/event-store.js'
import type { JsonValue } from '../persistence/json.js'
import type {
  NodeExecutionRecord,
  OutputChunk,
  PersistedArtifact,
  ListRunsInput,
  RunRecord,
  RunRepository,
} from '../persistence/run-repository.js'
import type { WorkflowRepository } from '../persistence/workflow-repository.js'

export type RunServiceErrorCode =
  | 'RUN_ACTIVE'
  | 'RUN_ADMISSION_CLOSED'
  | 'RUN_NOT_FOUND'
  | 'RUN_REQUEST_INVALID'
  | 'RUN_VARIABLES_MISSING'
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_NOT_RUNNABLE'

export class RunServiceError extends Error {
  override readonly name = 'RunServiceError'
  readonly activeRunId?: RunId
  readonly missingVariables?: readonly string[]

  constructor(
    readonly code: RunServiceErrorCode,
    message: string,
    options?: Readonly<{
      activeRunId?: RunId
      missingVariables?: readonly string[]
      cause?: unknown
    }>,
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    if (options?.activeRunId !== undefined) this.activeRunId = options.activeRunId
    if (options?.missingVariables !== undefined)
      this.missingVariables = Object.freeze([...options.missingVariables])
  }
}

export type CreateRunServiceInput = CreateRunRequest

export type PublicRunRecord = Omit<
  RunRecord,
  'profileSnapshotId' | 'taskReference' | 'notes' | 'taskSnapshot'
>

export interface RunDetail {
  readonly run: PublicRunRecord
  readonly events: ReturnType<EventStore['list']>['events']
  readonly nodeExecutions: readonly NodeExecutionRecord[]
  readonly outputChunks: readonly OutputChunk[]
  readonly artifacts: readonly PersistedArtifact[]
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
  create(input: CreateRunServiceInput): Promise<PublicRunRecord>
  get(runId: string): RunDetail | undefined
  list(input: ListRunsInput): RunSummaryPage
}

export interface CreateRunServiceOptions {
  readonly events: EventStore
  readonly runs: RunRepository
  readonly workflows: WorkflowRepository
  readonly now?: () => string
  readonly createRunId?: () => string
}

const cloneJson = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value

const publicRun = (run: RunRecord): PublicRunRecord => ({
  runId: run.runId,
  workflowId: run.workflowId,
  workflowSnapshot: run.workflowSnapshot,
  variables: run.variables,
  missingVariables: run.missingVariables,
  status: run.status,
  currentNodeId: run.currentNodeId,
  transitionCount: run.transitionCount,
  createdAt: run.createdAt,
  startedAt: run.startedAt,
  completedAt: run.completedAt,
})

const duration = (run: RunRecord): number | null => {
  if (run.startedAt === null || run.completedAt === null) return null
  return Math.max(0, Date.parse(run.completedAt) - Date.parse(run.startedAt))
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
      const validation = validateWorkflow(workflow, { registeredCommandIds: new Set() })
      if (
        !validation.valid ||
        workflow.startNodeId === null ||
        workflow.nodes.length === 0 ||
        workflow.nodes.some((node) => node.type !== 'agent')
      ) {
        throw new RunServiceError(
          'WORKFLOW_NOT_RUNNABLE',
          'Workflow is not runnable by the V1 agent runtime',
        )
      }

      const variables = cloneJson(parsed.variables ?? {}) as Readonly<Record<string, JsonValue>>
      const templates = workflow.nodes.flatMap((node) =>
        node.type === 'agent' ? [node.job.prompt] : [],
      )
      const detectedMissing = new Set(findMissingPromptVariables(templates, variables))
      const missingVariables = getWorkflowPromptVariableNames(workflow).filter((name) =>
        detectedMissing.has(name),
      )
      if (missingVariables.length > 0 && parsed.confirmMissingVariables !== true) {
        throw new RunServiceError(
          'RUN_VARIABLES_MISSING',
          'Required workflow variables are missing',
          { missingVariables },
        )
      }

      requireAdmissionsOpen()
      const run = options.runs.create({
        runId: RunIdSchema.parse(createRunId()),
        workflowId,
        workflowSnapshot: WorkflowSchema.parse(cloneJson(validation.workflow)),
        variables,
        missingVariables,
        createdAt: now(),
      })
      return publicRun(run)
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
        run: publicRun(run),
        events,
        nodeExecutions: options.runs.listNodeExecutions(runId),
        outputChunks: options.runs.listOutputChunks(runId),
        artifacts: options.runs.listArtifacts(runId),
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
