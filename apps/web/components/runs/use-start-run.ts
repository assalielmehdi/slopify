import { useEffect, useRef, useState } from 'react'

import {
  DEFAULT_PROFILE_ID,
  DEFAULT_TASK_REFERENCE,
  type ProjectProfileCatalogResponse,
  type ProjectProfileReadiness,
} from '@loop/contracts'
import { PREDEFINED_V1_WORKFLOW_ID } from '@loop/workflow-model'

import {
  ApiClientError,
  type ApiClient,
  type ClickUpTaskSnapshot,
  type StartRunResponse,
  type WorkflowCatalogEntry,
} from '@/lib/api-client'

export type StartRunErrorScope = 'load' | 'profile' | 'revision' | 'start' | 'task'

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

const normalizeStartError = (cause: unknown): StartRunError => {
  if (!(cause instanceof ApiClientError)) {
    return { scope: 'start', message: 'Run could not be started.' }
  }
  if (cause.code === 'PROFILE_NOT_READY') return { scope: 'profile', message: cause.message }
  if (cause.code === 'TASK_RESOLUTION_FAILED') return { scope: 'task', message: cause.message }
  if (cause.code === 'WORKFLOW_NOT_FOUND') return { scope: 'revision', message: cause.message }
  return {
    scope: 'start',
    message: cause.message,
    ...(cause.code === 'RUN_ACTIVE' ? { activeRunId: activeRunIdFrom(cause.details) } : {}),
  }
}

export function useStartRun(client: ApiClient) {
  const readinessRequest = useRef(0)
  const [catalog, setCatalog] = useState<ProjectProfileCatalogResponse>()
  const [workflows, setWorkflows] = useState<readonly WorkflowCatalogEntry[]>([])
  const [workflowId, setWorkflowId] = useState('')
  const [revisionId, setRevisionId] = useState('')
  const [profileId, setProfileId] = useState('')
  const [readiness, setReadiness] = useState<ProjectProfileReadiness>()
  const [taskReference, setTaskReference] = useState('')
  const [notes, setNotes] = useState('')
  const [task, setTask] = useState<ClickUpTaskSnapshot>()
  const [confirmed, setConfirmed] = useState(false)
  const [startedRun, setStartedRun] = useState<StartRunResponse>()
  const [error, setError] = useState<StartRunError>()
  const [loading, setLoading] = useState(true)
  const [readinessPending, setReadinessPending] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const [nextWorkflows, nextCatalog] = await Promise.all([
          client.listWorkflows(),
          client.listProjectProfiles(),
        ])
        if (!active) return
        setWorkflows(nextWorkflows)
        setCatalog(nextCatalog)
        const workflow = nextWorkflows[0]
        const profile = nextCatalog.profiles[0]
        if (workflow !== undefined) {
          setWorkflowId(workflow.workflowId)
          setRevisionId(workflow.latestRevisionId)
        }
        if (profile !== undefined) {
          setProfileId(profile.profileId)
          setReadinessPending(true)
          const request = ++readinessRequest.current
          const usesDefaultTask =
            profile.profileId === DEFAULT_PROFILE_ID &&
            workflow?.workflowId === PREDEFINED_V1_WORKFLOW_ID
          const [nextReadiness, nextTask] = await Promise.all([
            client.getProjectProfileReadiness(profile.profileId),
            usesDefaultTask
              ? client.resolveClickUpTask({
                  taskReference: DEFAULT_TASK_REFERENCE,
                  profileId: DEFAULT_PROFILE_ID,
                })
              : Promise.resolve(undefined),
          ])
          if (active && request === readinessRequest.current) {
            setReadiness(nextReadiness)
            if (nextTask !== undefined) {
              setTaskReference(DEFAULT_TASK_REFERENCE)
              setTask(nextTask)
            }
          }
        }
      } catch (cause) {
        if (active) {
          setError({
            scope: 'load',
            message: cause instanceof Error ? cause.message : 'Run configuration could not load.',
          })
        }
      } finally {
        if (active) {
          setLoading(false)
          setReadinessPending(false)
        }
      }
    }
    void load()
    return () => {
      active = false
      readinessRequest.current += 1
    }
  }, [client])

  const selectedWorkflow = workflows.find((workflow) => workflow.workflowId === workflowId)
  const selectedProfile = catalog?.profiles.find((profile) => profile.profileId === profileId)
  const usesDefaultTask =
    profileId === DEFAULT_PROFILE_ID && taskReference === DEFAULT_TASK_REFERENCE
  const profileError =
    error?.scope === 'profile'
      ? error.message
      : readiness !== undefined && !readiness.ready
        ? 'Project profile is not ready.'
        : undefined
  const canStart =
    task !== undefined &&
    selectedWorkflow !== undefined &&
    selectedProfile !== undefined &&
    revisionId !== '' &&
    readiness?.ready === true &&
    confirmed &&
    !starting &&
    startedRun === undefined

  const resetConfirmation = () => {
    setConfirmed(false)
    setStartedRun(undefined)
    setError(undefined)
  }

  const changeWorkflow = (nextWorkflowId: string) => {
    const nextWorkflow = workflows.find((workflow) => workflow.workflowId === nextWorkflowId)
    setWorkflowId(nextWorkflowId)
    setRevisionId(nextWorkflow?.latestRevisionId ?? '')
    resetConfirmation()
  }

  const changeRevision = (nextRevisionId: string) => {
    setRevisionId(nextRevisionId)
    resetConfirmation()
  }

  const changeTaskReference = (nextTaskReference: string) => {
    setTaskReference(nextTaskReference)
    setTask(undefined)
    resetConfirmation()
  }

  const selectProfile = async (nextProfileId: string) => {
    const request = ++readinessRequest.current
    setProfileId(nextProfileId)
    setReadiness(undefined)
    setTask(undefined)
    resetConfirmation()
    setReadinessPending(true)
    try {
      const nextReadiness = await client.getProjectProfileReadiness(nextProfileId)
      if (request === readinessRequest.current) setReadiness(nextReadiness)
    } catch (cause) {
      if (request === readinessRequest.current) {
        setError({
          scope: 'profile',
          message: cause instanceof Error ? cause.message : 'Profile readiness could not load.',
        })
      }
    } finally {
      if (request === readinessRequest.current) setReadinessPending(false)
    }
  }

  const resolveTask = async () => {
    const reference = taskReference.trim()
    if (reference === '' || selectedProfile === undefined) {
      setError({ scope: 'task', message: 'Enter a ClickUp task ID or URL.' })
      return
    }
    setResolving(true)
    setTask(undefined)
    resetConfirmation()
    try {
      setTask(await client.resolveClickUpTask({ taskReference: reference, profileId }))
    } catch (cause) {
      setError({
        scope: 'task',
        message: cause instanceof Error ? cause.message : 'Task could not be resolved.',
      })
    } finally {
      setResolving(false)
    }
  }

  const start = async () => {
    if (!canStart) return
    setStarting(true)
    setStartedRun(undefined)
    setError(undefined)
    const normalizedNotes = notes.trim()
    try {
      setStartedRun(
        await client.startRun({
          taskReference: taskReference.trim(),
          workflowId,
          revisionId,
          profileId,
          ...(normalizedNotes === '' ? {} : { notes: normalizedNotes }),
        }),
      )
    } catch (cause) {
      setError(normalizeStartError(cause))
    } finally {
      setStarting(false)
    }
  }

  return {
    canStart,
    catalog,
    changeRevision,
    changeTaskReference,
    changeWorkflow,
    confirmed,
    error,
    loading,
    notes,
    profileError,
    profileId,
    readiness,
    readinessPending,
    resolveTask,
    resolving,
    revisionId,
    selectProfile,
    selectedProfile,
    selectedWorkflow,
    setConfirmed,
    setNotes,
    start,
    startedRun,
    starting,
    task,
    taskReference,
    usesDefaultTask,
    workflowId,
    workflows,
  }
}
