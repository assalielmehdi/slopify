import { useEffect, useState } from 'react'

import type { HarnessDescriptor, Repository } from '@slopify/shared'
import type { Workflow } from '@slopify/shared'

import type { RunVariableRow } from '@/components/runs/run-configuration-fields'
import {
  ApiClientError,
  type ApiClient,
  type JsonValue,
  type StartRunResponse,
  type WorkflowCatalogEntry,
} from '@/lib/api-client'
import { workflowRunDisabledReason } from '@/lib/workflow-run-readiness'

export type StartRunErrorScope = 'load' | 'start'

export interface StartRunError {
  readonly message: string
  readonly scope: StartRunErrorScope
}

const normalizeStartError = (cause: unknown): StartRunError => {
  if (!(cause instanceof ApiClientError)) {
    return { scope: 'start', message: 'Run could not be started.' }
  }
  return {
    scope: 'start',
    message: cause.message,
  }
}

const requiredRows = (workflow: Workflow): readonly RunVariableRow[] =>
  workflow.configuration.variables.map((key, index) => ({
    id: `required-${index}`,
    key,
    value: '',
  }))

const parseVariableValue = (value: string): JsonValue => {
  try {
    return JSON.parse(value) as JsonValue
  } catch {
    return value
  }
}

const variablesFrom = (rows: readonly RunVariableRow[]): Readonly<Record<string, JsonValue>> =>
  Object.fromEntries(rows.map((row) => [row.key, parseVariableValue(row.value)] as const))

export type StartRunClient = Pick<
  ApiClient,
  'listHarnesses' | 'listRepositories' | 'listWorkflows' | 'startRun'
>

export interface UseStartRunOptions {
  readonly initialWorkflowId?: string | undefined
  readonly requireInitialWorkflow?: boolean | undefined
}

export function useStartRun(client: StartRunClient, options: UseStartRunOptions = {}) {
  const [workflows, setWorkflows] = useState<readonly WorkflowCatalogEntry[]>([])
  const [harnesses, setHarnesses] = useState<readonly HarnessDescriptor[]>([])
  const [repositories, setRepositories] = useState<readonly Repository[]>([])
  const [workflowId, setWorkflowId] = useState('')
  const [rows, setRows] = useState<readonly RunVariableRow[]>([])
  const [startedRun, setStartedRun] = useState<StartRunResponse>()
  const [error, setError] = useState<StartRunError>()
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const [nextWorkflows, nextHarnesses, nextRepositories] = await Promise.all([
          client.listWorkflows(),
          client.listHarnesses(),
          client.listRepositories(),
        ])
        if (!active) return
        setWorkflows(nextWorkflows)
        setHarnesses(nextHarnesses)
        setRepositories(nextRepositories)
        const requestedWorkflow = nextWorkflows.find(
          ({ workflowId: candidateId }) => candidateId === options.initialWorkflowId,
        )
        const workflow =
          requestedWorkflow ??
          (options.initialWorkflowId === undefined || options.requireInitialWorkflow !== true
            ? nextWorkflows[0]
            : undefined)
        if (workflow !== undefined) {
          setWorkflowId(workflow.workflowId)
          setRows(requiredRows(workflow))
        } else if (options.initialWorkflowId !== undefined) {
          setWorkflowId(options.initialWorkflowId)
          setRows([])
        }
      } catch (cause) {
        if (active) {
          setError({
            scope: 'load',
            message: cause instanceof Error ? cause.message : 'Run configuration could not load.',
          })
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [client, options.initialWorkflowId, options.requireInitialWorkflow])

  const selectedWorkflow = workflows.find((workflow) => workflow.workflowId === workflowId)
  const runDisabledReason =
    selectedWorkflow === undefined
      ? 'Choose a workflow before starting a run.'
      : workflowRunDisabledReason({ harnesses, repositories, workflow: selectedWorkflow })
  const runnable = runDisabledReason === undefined
  const canStart =
    selectedWorkflow !== undefined &&
    runnable &&
    rows.every(({ value }) => value !== '') &&
    !starting &&
    startedRun === undefined

  const reset = () => {
    setStartedRun(undefined)
    setError(undefined)
  }

  const changeWorkflow = (nextWorkflowId: string) => {
    const workflow = workflows.find(({ workflowId: candidateId }) => candidateId === nextWorkflowId)
    setWorkflowId(nextWorkflowId)
    setRows(workflow === undefined ? [] : requiredRows(workflow))
    reset()
  }

  const changeVariable = (id: string, value: string) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, value } : row)))
    reset()
  }

  const start = async () => {
    if (!canStart) return
    setStarting(true)
    setStartedRun(undefined)
    setError(undefined)
    try {
      const run = await client.startRun({
        workflowId,
        variables: variablesFrom(rows),
      })
      setStartedRun(run)
      return run
    } catch (cause) {
      setError(normalizeStartError(cause))
      return undefined
    } finally {
      setStarting(false)
    }
  }

  return {
    canStart,
    changeVariable,
    changeWorkflow,
    error,
    loading,
    rows,
    runnable,
    runDisabledReason,
    selectedWorkflow,
    start,
    startedRun,
    starting,
    workflowId,
    workflows,
  }
}
