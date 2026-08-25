'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useReducer, useRef } from 'react'

import type { HarnessDescriptor, Repository } from '@slopify/contracts'
import type { Workflow } from '@slopify/workflow-model'

import { StartRunDrawer } from '@/components/runs/start-run-drawer'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { WorkflowCanvas } from '@/components/workflow/workflow-canvas'
import { WorkflowConfigDrawer } from '@/components/workflow/workflow-config-drawer'
import { createApiClient, type ApiClient } from '@/lib/api-client'
import {
  connectResourceEventStream,
  type ConnectResourceEventStream,
} from '@/lib/resource-event-stream'
import { announceWorkflowCatalogChanged } from '@/lib/workflow-catalog-events'
import { workflowRunDisabledReason } from '@/lib/workflow-run-readiness'

type WorkflowEditorClient = Pick<
  ApiClient,
  | 'deleteWorkflow'
  | 'getWorkflow'
  | 'listHarnesses'
  | 'listRepositories'
  | 'listWorkflows'
  | 'startRun'
  | 'updateWorkflow'
>

export interface WorkflowWorkbenchProps {
  readonly client?: WorkflowEditorClient
  readonly connectResourceEvents?: ConnectResourceEventStream
  readonly selectedWorkflowId?: string | undefined
}

interface WorkflowWorkbenchState {
  readonly workflow: Workflow | undefined
  readonly selectedNodeId: string | undefined
  readonly runDrawerOpen: boolean
  readonly configDrawerOpen: boolean
  readonly harnesses: readonly HarnessDescriptor[]
  readonly repositories: readonly Repository[]
  readonly loading: boolean
  readonly saving: boolean
  readonly error: string | undefined
  readonly harnessError: string | undefined
  readonly repositoryCatalogError: string | undefined
  readonly saveError: string | undefined
  readonly externalChangeConflict: string | undefined
  readonly refreshVersion: number
}

type WorkflowWorkbenchUpdate =
  | Partial<WorkflowWorkbenchState>
  | ((state: WorkflowWorkbenchState) => Partial<WorkflowWorkbenchState>)

const initialWorkflowWorkbenchState: WorkflowWorkbenchState = {
  workflow: undefined,
  selectedNodeId: undefined,
  runDrawerOpen: false,
  configDrawerOpen: false,
  harnesses: [],
  repositories: [],
  loading: true,
  saving: false,
  error: undefined,
  harnessError: undefined,
  repositoryCatalogError: undefined,
  saveError: undefined,
  externalChangeConflict: undefined,
  refreshVersion: 0,
}

const updateWorkflowWorkbench = (
  state: WorkflowWorkbenchState,
  update: WorkflowWorkbenchUpdate,
): WorkflowWorkbenchState => ({
  ...state,
  ...(typeof update === 'function' ? update(state) : update),
})

const defaultClient = createApiClient()

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'The workflow could not be loaded'

function useWorkflowWorkbench(
  client: WorkflowEditorClient,
  connectResourceEvents: ConnectResourceEventStream,
  selectedWorkflowId?: string,
) {
  const router = useRouter()
  const [state, update] = useReducer(updateWorkflowWorkbench, initialWorkflowWorkbenchState)
  const loadSequence = useRef(0)
  const activeWorkflowId = useRef<string | undefined>(undefined)
  const loadedWorkflowId = useRef<string | undefined>(undefined)
  const loadedWorkflowSnapshot = useRef<string | undefined>(undefined)
  const configDirty = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state
  const requestedWorkflowId = selectedWorkflowId

  useEffect(() => {
    let active = true
    const sequence = ++loadSequence.current

    const load = async () => {
      try {
        const [workflows, harnesses, repositories] = await Promise.all([
          client.listWorkflows(),
          client.listHarnesses().catch((cause: unknown) => {
            if (active) update({ harnessError: errorMessage(cause) })
            return [] as readonly HarnessDescriptor[]
          }),
          client.listRepositories().catch((cause: unknown) => {
            if (active) update({ repositoryCatalogError: errorMessage(cause) })
            return [] as const
          }),
        ])
        const catalogEntry =
          workflows.find(({ workflowId }) => workflowId === requestedWorkflowId) ?? workflows[0]
        if (catalogEntry === undefined) {
          activeWorkflowId.current = undefined
          loadedWorkflowId.current = undefined
          if (active && sequence === loadSequence.current) {
            update({
              workflow: undefined,
              harnesses,
              repositories,
              error: undefined,
              externalChangeConflict: undefined,
            })
          }
          return
        }
        activeWorkflowId.current = catalogEntry.workflowId
        if (requestedWorkflowId !== catalogEntry.workflowId) {
          router.replace(`/?workflowId=${encodeURIComponent(catalogEntry.workflowId)}`)
        }

        const current = await client.getWorkflow(catalogEntry.workflowId)
        if (!active || sequence !== loadSequence.current) return
        loadedWorkflowId.current = current.workflowId
        loadedWorkflowSnapshot.current = JSON.stringify(current)
        update({
          workflow: current,
          harnesses,
          repositories,
          error: undefined,
          externalChangeConflict: undefined,
        })
      } catch (cause) {
        if (active && sequence === loadSequence.current) {
          const previousWorkflowId = loadedWorkflowId.current
          activeWorkflowId.current = previousWorkflowId
          if (previousWorkflowId !== undefined) {
            router.replace(`/?workflowId=${encodeURIComponent(previousWorkflowId)}`)
          }
          update({ error: errorMessage(cause) })
        }
      } finally {
        if (active && sequence === loadSequence.current) update({ loading: false })
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [client, requestedWorkflowId, router, state.refreshVersion])

  useEffect(
    () =>
      connectResourceEvents({
        onDisconnect: () => undefined,
        onEvent: (event) => {
          if (event.resource.type === 'WORKFLOW') {
            announceWorkflowCatalogChanged()
            if (event.resource.workflowId !== activeWorkflowId.current) return
            if (configDirty.current) {
              update({
                externalChangeConflict:
                  event.change === 'DELETED'
                    ? 'This workflow was deleted outside Slopify. Close the editor to refresh the catalog.'
                    : 'This workflow changed outside Slopify. Close and reopen to load the latest file.',
              })
              return
            }
            update((current) => ({ refreshVersion: current.refreshVersion + 1 }))
            return
          }
          if (event.resource.type === 'REPOSITORIES' && !configDirty.current) {
            update((current) => ({ refreshVersion: current.refreshVersion + 1 }))
          }
        },
        onInvalidEvent: () => undefined,
        onOpen: () => undefined,
        onReconcile: async () => {
          const workflowId = activeWorkflowId.current
          if (workflowId === undefined) return
          if (!configDirty.current) {
            update((current) => ({ refreshVersion: current.refreshVersion + 1 }))
            return
          }
          try {
            const external = await client.getWorkflow(workflowId, { preserveRevision: true })
            if (JSON.stringify(external) !== loadedWorkflowSnapshot.current) {
              update({
                externalChangeConflict:
                  'This workflow changed outside Slopify. Close and reopen to load the latest file.',
              })
            }
          } catch {
            update({
              externalChangeConflict:
                'This workflow is no longer readable from disk. Close the editor to refresh the catalog.',
            })
          }
        },
      }),
    [client, connectResourceEvents],
  )

  const { workflow } = state
  if (workflow === undefined) {
    return {
      ready: false as const,
      empty: !state.loading && state.error === undefined,
      error: state.error,
      loading: state.loading,
    }
  }

  const runDisabledReason = workflowRunDisabledReason({
    workflow,
    ...(state.harnessError === undefined ? { harnesses: state.harnesses } : {}),
    ...(state.repositoryCatalogError === undefined ? { repositories: state.repositories } : {}),
  })
  const runnable = runDisabledReason === undefined

  const persist = async (next: Workflow) => {
    update({ saving: true, saveError: undefined })
    try {
      const saved = await client.updateWorkflow(workflow.workflowId, next)
      if (activeWorkflowId.current === saved.workflowId) {
        loadedWorkflowSnapshot.current = JSON.stringify(saved)
        configDirty.current = false
        update({ workflow: saved, externalChangeConflict: undefined })
      }
      if (saved.name !== workflow.name) announceWorkflowCatalogChanged()
      return saved
    } catch (cause) {
      update({ saveError: errorMessage(cause) })
      return undefined
    } finally {
      update({ saving: false })
    }
  }

  const selectNode = (nodeId: string) => {
    update({
      configDrawerOpen: false,
      runDrawerOpen: false,
      selectedNodeId: nodeId,
    })
  }

  const saveWorkflowConfiguration = async (value: Workflow) => {
    if (stateRef.current.externalChangeConflict !== undefined) return false
    return (await persist(value)) !== undefined
  }

  const deleteWorkflow = async () => {
    update({ saving: true, saveError: undefined })
    try {
      await client.deleteWorkflow(workflow.workflowId)
      const remainingWorkflows = (await client.listWorkflows()).filter(
        ({ workflowId }) => workflowId !== workflow.workflowId,
      )
      announceWorkflowCatalogChanged()
      const nextWorkflow = remainingWorkflows[0]
      router.replace(
        nextWorkflow === undefined
          ? '/'
          : `/?workflowId=${encodeURIComponent(nextWorkflow.workflowId)}`,
      )
      return true
    } catch (cause) {
      update({ saveError: errorMessage(cause) })
      return false
    } finally {
      update({ saving: false })
    }
  }

  return {
    ready: true as const,
    ...state,
    workflow,
    runDisabledReason,
    runnable,
    selectNode,
    saveWorkflowConfiguration,
    deleteWorkflow,
    closeConfigDrawer: () => {
      const refreshAfterClose = stateRef.current.externalChangeConflict !== undefined
      configDirty.current = false
      update((current) => ({
        configDrawerOpen: false,
        externalChangeConflict: undefined,
        ...(refreshAfterClose ? { refreshVersion: current.refreshVersion + 1 } : {}),
      }))
    },
    closeRunDrawer: () => update({ runDrawerOpen: false }),
    openRunDrawer: () => {
      if (!runnable) return
      update({
        selectedNodeId: undefined,
        configDrawerOpen: false,
        runDrawerOpen: true,
      })
    },
    openConfigDrawer: () => {
      configDirty.current = false
      update({
        selectedNodeId: undefined,
        runDrawerOpen: false,
        configDrawerOpen: true,
        saveError: undefined,
        externalChangeConflict: undefined,
      })
    },
    setConfigDirty: (dirty: boolean) => {
      configDirty.current = dirty
    },
  }
}

export function WorkflowWorkbench({
  client = defaultClient,
  connectResourceEvents = connectResourceEventStream,
  selectedWorkflowId,
}: WorkflowWorkbenchProps) {
  const state = useWorkflowWorkbench(client, connectResourceEvents, selectedWorkflowId)

  if (!state.ready) {
    if (state.empty) {
      return (
        <section aria-label="Editor" className="relative flex h-full min-h-0 flex-col">
          <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
            <div className="max-w-sm">
              <h2 className="text-[18px]/6 font-semibold tracking-[-0.01em]">
                Create your first workflow
              </h2>
              <p className="mt-2 text-sm/5 text-muted-foreground">
                Workflows keep each repository process, graph, and run configuration independent.
              </p>
            </div>
          </div>
        </section>
      )
    }
    return (
      <section
        aria-busy={state.loading}
        aria-label="Editor"
        className="flex h-full w-full flex-col"
      >
        {state.error === undefined ? (
          <div aria-label="Loading workflow" className="h-full" role="status">
            <Skeleton className="h-full min-h-136 w-full" />
          </div>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Workflow unavailable</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
      </section>
    )
  }

  return (
    <section aria-label="Editor" className="relative flex h-full min-h-0 min-w-0 flex-col">
      {state.error === undefined ? null : (
        <Alert className="mx-4 mt-4" variant="destructive">
          <AlertTitle>Workflow not switched</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="relative min-h-0 flex-1">
        <WorkflowCanvas
          onConfigure={state.openConfigDrawer}
          onNodeSelect={state.selectNode}
          onRun={state.openRunDrawer}
          runDisabledReason={state.runDisabledReason}
          runnable={state.runnable}
          selectedNodeId={state.selectedNodeId}
          workflow={state.workflow}
        />
      </div>

      {state.configDrawerOpen ? (
        <WorkflowConfigDrawer
          key={JSON.stringify(state.workflow)}
          conflict={state.externalChangeConflict}
          error={state.repositoryCatalogError ?? state.saveError}
          onClose={state.closeConfigDrawer}
          onDelete={state.deleteWorkflow}
          onDirtyChange={state.setConfigDirty}
          onSubmit={state.saveWorkflowConfiguration}
          repositories={state.repositories}
          saving={state.saving}
          value={state.workflow}
        />
      ) : null}

      {state.runDrawerOpen ? (
        <StartRunDrawer
          client={client}
          onClose={state.closeRunDrawer}
          workflowId={state.workflow.workflowId}
        />
      ) : null}
    </section>
  )
}
