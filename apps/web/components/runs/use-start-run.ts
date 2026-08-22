import { useEffect, useRef, useState } from 'react'

import { getWorkflowPromptVariableNames, type Workflow } from '@slopify/workflow-model'

import type { RunVariableRow } from '@/components/runs/run-configuration-fields'
import {
  ApiClientError,
  type ApiClient,
  type JsonValue,
  type StartRunResponse,
  type WorkflowCatalogEntry,
} from '@/lib/api-client'

export type StartRunErrorScope = 'load' | 'start'

export interface StartRunError {
  readonly activeRunId?: string | undefined
  readonly message: string
  readonly scope: StartRunErrorScope
}

const activeRunIdFrom = (details: unknown): string | undefined => {
  if (typeof details !== 'object' || details === null || !('activeRunId' in details))
    return undefined
  const activeRunId = details.activeRunId
  return typeof activeRunId === 'string' && activeRunId !== '' ? activeRunId : undefined
}

const missingVariablesFrom = (details: unknown): readonly string[] | undefined => {
  if (typeof details !== 'object' || details === null || !('missingVariables' in details))
    return undefined
  const missingVariables = details.missingVariables
  if (
    !Array.isArray(missingVariables) ||
    !missingVariables.every((value) => typeof value === 'string')
  )
    return undefined
  return missingVariables
}

const normalizeStartError = (cause: unknown): StartRunError => {
  if (!(cause instanceof ApiClientError)) {
    return { scope: 'start', message: 'Run could not be started.' }
  }
  return {
    scope: 'start',
    message: cause.message,
    ...(cause.code === 'RUN_ACTIVE' ? { activeRunId: activeRunIdFrom(cause.details) } : {}),
  }
}

const requiredRows = (workflow: Workflow): readonly RunVariableRow[] =>
  getWorkflowPromptVariableNames(workflow).map((key, index) => ({
    id: `required-${index}`,
    key,
    required: true,
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
  Object.fromEntries(
    rows
      .filter((row) => row.value !== '')
      .map((row) => [row.key.trim(), parseVariableValue(row.value)] as const)
      .filter(([key]) => key !== ''),
  )

const hasValidKeys = (rows: readonly RunVariableRow[]): boolean => {
  const keys = rows.map(({ key }) => key.trim())
  return keys.every((key) => key !== '') && new Set(keys).size === keys.length
}

export function useStartRun(client: ApiClient) {
  const nextRowId = useRef(0)
  const [workflows, setWorkflows] = useState<readonly WorkflowCatalogEntry[]>([])
  const [workflowId, setWorkflowId] = useState('')
  const [rows, setRows] = useState<readonly RunVariableRow[]>([])
  const [missingVariables, setMissingVariables] = useState<readonly string[]>([])
  const [startedRun, setStartedRun] = useState<StartRunResponse>()
  const [error, setError] = useState<StartRunError>()
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const nextWorkflows = await client.listWorkflows()
        if (!active) return
        setWorkflows(nextWorkflows)
        const workflow = nextWorkflows[0]
        if (workflow !== undefined) {
          setWorkflowId(workflow.workflowId)
          setRows(requiredRows(workflow))
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
  }, [client])

  const selectedWorkflow = workflows.find((workflow) => workflow.workflowId === workflowId)
  const runnable = selectedWorkflow?.nodes.some(({ type }) => type === 'agent') === true
  const canStart =
    selectedWorkflow !== undefined &&
    runnable &&
    hasValidKeys(rows) &&
    !starting &&
    startedRun === undefined

  const resetConfirmation = () => {
    setMissingVariables([])
    setStartedRun(undefined)
    setError(undefined)
  }

  const changeWorkflow = (nextWorkflowId: string) => {
    const workflow = workflows.find(({ workflowId: candidateId }) => candidateId === nextWorkflowId)
    setWorkflowId(nextWorkflowId)
    setRows(workflow === undefined ? [] : requiredRows(workflow))
    resetConfirmation()
  }

  const addVariable = () => {
    nextRowId.current += 1
    setRows((current) => [
      ...current,
      { id: `extra-${nextRowId.current}`, key: '', required: false, value: '' },
    ])
    resetConfirmation()
  }

  const removeVariable = (id: string) => {
    setRows((current) => current.filter((row) => row.id !== id || row.required))
    resetConfirmation()
  }

  const changeVariable = (id: string, field: 'key' | 'value', value: string) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)))
    resetConfirmation()
  }

  const start = async (confirmMissingVariables = false) => {
    if (!canStart) return
    setStarting(true)
    setStartedRun(undefined)
    setError(undefined)
    try {
      setStartedRun(
        await client.startRun({
          workflowId,
          variables: variablesFrom(rows),
          ...(confirmMissingVariables ? { confirmMissingVariables: true } : {}),
        }),
      )
      setMissingVariables([])
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.code === 'RUN_VARIABLES_MISSING') {
        const missing = missingVariablesFrom(cause.details)
        if (missing !== undefined && missing.length > 0) {
          setMissingVariables(missing)
          return
        }
      }
      setError(normalizeStartError(cause))
    } finally {
      setStarting(false)
    }
  }

  return {
    addVariable,
    canStart,
    changeVariable,
    changeWorkflow,
    error,
    loading,
    missingVariables,
    removeVariable,
    rows,
    runnable,
    selectedWorkflow,
    start,
    startedRun,
    starting,
    workflowId,
    workflows,
  }
}
