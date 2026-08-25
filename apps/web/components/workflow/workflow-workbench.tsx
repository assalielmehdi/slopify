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

function useWorkflowWorkbench(client: WorkflowEditorClient, selectedWorkflowId?: string) {
  const router = useRouter()
  const [state, update] = useReducer(updateWorkflowWorkbench, initialWorkflowWorkbenchState)
  const loadSequence = useRef(0)
  const activeWorkflowId = useRef<string | undefined>(undefined)
  const loadedWorkflowId = useRef<string | undefined>(undefined)
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
            update({ workflow: undefined, harnesses, repositories, error: undefined })
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
        update({ workflow: current, harnesses, repositories, error: undefined })
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
  }, [client, requestedWorkflowId, router])

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
        update({ workflow: saved })
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

  const saveWorkflowConfiguration = async (value: Workflow) => (await persist(value)) !== undefined

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
    closeConfigDrawer: () => update({ configDrawerOpen: false }),
    closeRunDrawer: () => update({ runDrawerOpen: false }),
    openRunDrawer: () => {
      if (!runnable) return
      update({
        selectedNodeId: undefined,
        configDrawerOpen: false,
        runDrawerOpen: true,
      })
    },
    openConfigDrawer: () =>
      update({
        selectedNodeId: undefined,
        runDrawerOpen: false,
        configDrawerOpen: true,
        saveError: undefined,
      }),
  }
}

export function WorkflowWorkbench({
  client = defaultClient,
  selectedWorkflowId,
}: WorkflowWorkbenchProps) {
  const state = useWorkflowWorkbench(client, selectedWorkflowId)

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
          error={state.repositoryCatalogError ?? state.saveError}
          onClose={state.closeConfigDrawer}
          onDelete={state.deleteWorkflow}
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
