'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useReducer, useRef } from 'react'

import type { HarnessDescriptor, Project } from '@slopify/contracts'
import {
  AgentNodeSchema,
  WorkflowEdgeSchema,
  type CreateWorkflowInput,
  type Workflow,
  type WorkflowEdge,
} from '@slopify/workflow-model'

import { StartRunDrawer } from '@/components/runs/start-run-drawer'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { AgentDrawer } from '@/components/workflow/agent-drawer'
import { WorkflowCanvas } from '@/components/workflow/workflow-canvas'
import { WorkflowConfigDrawer } from '@/components/workflow/workflow-config-drawer'
import { WorkflowSwitcher } from '@/components/workflow/workflow-switcher'
import { createAgentId, type AgentDrawerMode, type AgentFormValue } from '@/lib/agent-drawer'
import { createApiClient, type ApiClient } from '@/lib/api-client'
import { showUndoDeletionToast } from '@/lib/undo-deletion-toast'
import { workflowRunDisabledReason } from '@/lib/workflow-run-readiness'

type WorkflowEditorClient = Pick<
  ApiClient,
  | 'createWorkflow'
  | 'getWorkflow'
  | 'listHarnesses'
  | 'listProjects'
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
  readonly workflows: readonly Workflow[]
  readonly selectedNodeId: string | undefined
  readonly drawer: AgentDrawerMode | undefined
  readonly runDrawerOpen: boolean
  readonly configDrawerOpen: boolean
  readonly createWorkflowDrawerOpen: boolean
  readonly draftSourceNodeId: string | undefined
  readonly harnesses: readonly HarnessDescriptor[]
  readonly projects: readonly Project[]
  readonly loading: boolean
  readonly saving: boolean
  readonly switching: boolean
  readonly error: string | undefined
  readonly harnessError: string | undefined
  readonly projectCatalogError: string | undefined
  readonly saveError: string | undefined
}

type WorkflowWorkbenchUpdate =
  | Partial<WorkflowWorkbenchState>
  | ((state: WorkflowWorkbenchState) => Partial<WorkflowWorkbenchState>)

const initialWorkflowWorkbenchState: WorkflowWorkbenchState = {
  workflow: undefined,
  workflows: [],
  selectedNodeId: undefined,
  drawer: undefined,
  runDrawerOpen: false,
  configDrawerOpen: false,
  createWorkflowDrawerOpen: false,
  draftSourceNodeId: undefined,
  harnesses: [],
  projects: [],
  loading: true,
  saving: false,
  switching: false,
  error: undefined,
  harnessError: undefined,
  projectCatalogError: undefined,
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
        const [workflows, harnesses, projects] = await Promise.all([
          client.listWorkflows(),
          client.listHarnesses().catch((cause: unknown) => {
            if (active) update({ harnessError: errorMessage(cause) })
            return [] as readonly HarnessDescriptor[]
          }),
          client.listProjects().catch((cause: unknown) => {
            if (active) update({ projectCatalogError: errorMessage(cause) })
            return [] as const
          }),
        ])
        const catalogEntry =
          workflows.find(({ workflowId }) => workflowId === requestedWorkflowId) ?? workflows[0]
        if (catalogEntry === undefined) {
          activeWorkflowId.current = undefined
          loadedWorkflowId.current = undefined
          if (active && sequence === loadSequence.current) {
            update({ workflow: undefined, workflows, harnesses, projects, error: undefined })
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
        update({ workflow: current, workflows, harnesses, projects, error: undefined })
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

  const createWorkflow = async (input: CreateWorkflowInput) => {
    update({ saving: true, saveError: undefined })
    try {
      const created = await client.createWorkflow(input)
      ++loadSequence.current
      activeWorkflowId.current = created.workflowId
      loadedWorkflowId.current = created.workflowId
      update((current) => ({
        workflow: created,
        workflows: [created, ...current.workflows],
        createWorkflowDrawerOpen: false,
      }))
      router.push(`/?workflowId=${encodeURIComponent(created.workflowId)}`)
      return true
    } catch (cause) {
      update({ saveError: errorMessage(cause) })
      return false
    } finally {
      update({ saving: false })
    }
  }

  const { workflow } = state
  if (workflow === undefined) {
    return {
      ready: false as const,
      empty: !state.loading && state.error === undefined,
      error: state.error,
      loading: state.loading,
      projects: state.projects,
      saving: state.saving,
      saveError: state.saveError,
      createWorkflowDrawerOpen: state.createWorkflowDrawerOpen,
      createWorkflow,
      closeCreateWorkflowDrawer: () => update({ createWorkflowDrawerOpen: false }),
      openCreateWorkflowDrawer: () => update({ createWorkflowDrawerOpen: true }),
    }
  }

  const availableHarnesses = state.harnesses.filter(
    ({ availability }) => availability === 'AVAILABLE',
  )
  const addAgentDisabledReason =
    availableHarnesses.length > 0
      ? undefined
      : state.harnessError === undefined
        ? state.harnesses[0] === undefined
          ? 'Install a supported harness from Harnesses before adding an agent.'
          : `${state.harnesses[0].name} is unavailable. Open Harnesses for installation instructions before adding an agent.`
        : 'Harnesses could not be loaded. Open Harnesses and resolve discovery before adding an agent.'
  const runDisabledReason = workflowRunDisabledReason({
    workflow,
    ...(state.harnessError === undefined ? { harnesses: state.harnesses } : {}),
    ...(state.projectCatalogError === undefined ? { projects: state.projects } : {}),
  })
  const runnable = runDisabledReason === undefined

  const persist = async (next: Workflow) => {
    update({ saving: true, saveError: undefined })
    try {
      const saved = await client.updateWorkflow(workflow.workflowId, next)
      if (activeWorkflowId.current === saved.workflowId) {
        update((current) => ({
          workflow: saved,
          workflows: current.workflows.map((candidate) =>
            candidate.workflowId === saved.workflowId ? saved : candidate,
          ),
        }))
      }
      return saved
    } catch (cause) {
      update({ saveError: errorMessage(cause) })
      return undefined
    } finally {
      update({ saving: false })
    }
  }

  const selectNode = (nodeId: string) => {
    const agent = workflow.nodes.find((node) => node.id === nodeId)
    update({
      configDrawerOpen: false,
      runDrawerOpen: false,
      selectedNodeId: nodeId,
      ...(agent === undefined
        ? {}
        : {
            draftSourceNodeId: undefined,
            drawer: { kind: 'edit', agent },
            saveError: undefined,
          }),
    })
  }

  const saveAgent = async (value: AgentFormValue) => {
    const editedAgentId = state.drawer?.kind === 'edit' ? state.drawer.agent.id : undefined
    const currentAgent =
      editedAgentId === undefined
        ? undefined
        : workflow.nodes.find((node) => node.id === editedAgentId)
    const agent = AgentNodeSchema.parse({
      ...(currentAgent ?? {}),
      type: 'agent',
      id: value.id,
      name: value.name,
      prompt: value.prompt,
      harness: value.harness,
    })
    const nodes =
      currentAgent === undefined
        ? [...workflow.nodes, agent]
        : workflow.nodes.map((node) => (node.id === currentAgent.id ? agent : node))
    const edges =
      currentAgent === undefined && state.draftSourceNodeId !== undefined
        ? [
            ...workflow.edges,
            WorkflowEdgeSchema.parse({
              sourceNodeId: state.draftSourceNodeId,
              targetNodeId: agent.id,
              outcome: 'completed',
              label: 'Completed',
            }),
          ]
        : workflow.edges
    const saved = await persist({
      ...workflow,
      startNodeId: workflow.startNodeId ?? agent.id,
      nodes,
      edges,
    })
    if (saved === undefined) return false
    update({ selectedNodeId: agent.id, draftSourceNodeId: undefined })
    return true
  }

  const saveWorkflowConfiguration = async (value: CreateWorkflowInput) =>
    (await persist({ ...workflow, ...value })) !== undefined

  const deleteAgent = async () => {
    if (state.drawer?.kind !== 'edit') return false
    const deletedAgentId = state.drawer.agent.id
    const deletedAgent = workflow.nodes.find((node) => node.id === deletedAgentId)
    if (deletedAgent === undefined) return false

    const previousWorkflow = workflow
    const remainingNodes = workflow.nodes.filter((node) => node.id !== deletedAgent.id)
    const remainingNodeIds = new Set(remainingNodes.map(({ id }) => id))
    const startNodeId =
      workflow.startNodeId !== deletedAgent.id
        ? workflow.startNodeId
        : (workflow.edges.find(
            (edge) =>
              edge.sourceNodeId === deletedAgent.id && remainingNodeIds.has(edge.targetNodeId),
          )?.targetNodeId ??
          remainingNodes[0]?.id ??
          null)
    const edges = workflow.edges.filter(
      (edge) => edge.sourceNodeId !== deletedAgent.id && edge.targetNodeId !== deletedAgent.id,
    )
    if ((await persist({ ...workflow, startNodeId, nodes: remainingNodes, edges })) === undefined) {
      return false
    }

    update({ selectedNodeId: undefined })
    showUndoDeletionToast({
      receipt: { undoExpiresAt: new Date(Date.now() + 10_000).toISOString() },
      deletedTitle: 'Agent deleted',
      deletedDescription: `${deletedAgent.name} was removed from the workflow.`,
      restoredTitle: 'Agent restored',
      restoredDescription: `${deletedAgent.name} is available in the workflow again.`,
      async onUndo() {
        const restored = await client.updateWorkflow(previousWorkflow.workflowId, previousWorkflow)
        update({ workflow: restored })
      },
    })
    return true
  }

  const connectAgents = async (sourceNodeId: string, targetNodeId: string) => {
    if (
      sourceNodeId === targetNodeId ||
      targetNodeId === workflow.startNodeId ||
      workflow.edges.some(
        (edge) => edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId,
      )
    ) {
      return
    }
    await persist({
      ...workflow,
      edges: [
        ...workflow.edges,
        WorkflowEdgeSchema.parse({
          sourceNodeId,
          targetNodeId,
          outcome: 'completed',
          label: 'Completed',
        }),
      ],
    })
  }

  const deleteEdge = async (edgeToDelete: WorkflowEdge) => {
    await persist({
      ...workflow,
      edges: workflow.edges.filter((edge) => edge !== edgeToDelete),
    })
  }

  const draftNodeId =
    state.draftSourceNodeId === undefined
      ? undefined
      : createAgentId('New agent', new Set(workflow.nodes.map(({ id }) => id)))
  const draftSource = workflow.nodes.find((node) => node.id === state.draftSourceNodeId)
  const draftHarness =
    draftSource === undefined
      ? undefined
      : (availableHarnesses.find(({ harnessId }) => harnessId === draftSource.harness.harnessId) ??
        availableHarnesses[0])
  const canvasWorkflow =
    draftNodeId === undefined || draftSource === undefined || draftHarness === undefined
      ? workflow
      : {
          ...workflow,
          nodes: [
            ...workflow.nodes,
            AgentNodeSchema.parse({
              type: 'agent',
              id: draftNodeId,
              name: 'New agent',
              prompt: 'Configure this agent.',
              harness:
                draftHarness.harnessId === draftSource.harness.harnessId
                  ? draftSource.harness
                  : { harnessId: draftHarness.harnessId },
            }),
          ],
          edges: [
            ...workflow.edges,
            WorkflowEdgeSchema.parse({
              sourceNodeId: state.draftSourceNodeId,
              targetNodeId: draftNodeId,
              outcome: 'completed',
              label: 'Completed',
            }),
          ],
        }

  const closeAgentDrawer = () =>
    update({ draftSourceNodeId: undefined, selectedNodeId: undefined, drawer: undefined })

  const selectWorkflow = async (workflowId: string) => {
    if (workflowId === workflow.workflowId || state.saving || state.switching) return
    const sequence = ++loadSequence.current
    activeWorkflowId.current = workflowId
    update({
      switching: true,
      draftSourceNodeId: undefined,
      selectedNodeId: undefined,
      drawer: undefined,
      runDrawerOpen: false,
      configDrawerOpen: false,
      createWorkflowDrawerOpen: false,
      error: undefined,
      saveError: undefined,
    })
    router.push(`/?workflowId=${encodeURIComponent(workflowId)}`)
    try {
      const selected = await client.getWorkflow(workflowId)
      if (sequence !== loadSequence.current || activeWorkflowId.current !== workflowId) return
      loadedWorkflowId.current = selected.workflowId
      update({ workflow: selected })
    } catch (cause) {
      if (sequence === loadSequence.current) {
        activeWorkflowId.current = workflow.workflowId
        router.replace(`/?workflowId=${encodeURIComponent(workflow.workflowId)}`)
        update({ error: errorMessage(cause) })
      }
    } finally {
      if (sequence === loadSequence.current) update({ switching: false })
    }
  }

  return {
    ready: true as const,
    ...state,
    workflow,
    canvasWorkflow,
    addAgentDisabledReason,
    runDisabledReason,
    runnable,
    selectNode,
    saveAgent,
    saveWorkflowConfiguration,
    deleteAgent,
    connectAgents,
    deleteEdge,
    closeAgentDrawer,
    createWorkflow,
    selectWorkflow,
    closeConfigDrawer: () => update({ configDrawerOpen: false }),
    closeCreateWorkflowDrawer: () => update({ createWorkflowDrawerOpen: false }),
    closeRunDrawer: () => update({ runDrawerOpen: false }),
    openCreateDrawer: (sourceNodeId?: string) => {
      if (addAgentDisabledReason !== undefined) return
      update({
        runDrawerOpen: false,
        configDrawerOpen: false,
        createWorkflowDrawerOpen: false,
        draftSourceNodeId: sourceNodeId,
        selectedNodeId:
          sourceNodeId === undefined
            ? undefined
            : createAgentId('New agent', new Set(workflow.nodes.map(({ id }) => id))),
        drawer: { kind: 'create' },
        saveError: undefined,
      })
    },
    openRunDrawer: () => {
      if (!runnable) return
      update({
        draftSourceNodeId: undefined,
        selectedNodeId: undefined,
        drawer: undefined,
        configDrawerOpen: false,
        createWorkflowDrawerOpen: false,
        runDrawerOpen: true,
      })
    },
    openConfigDrawer: () =>
      update({
        draftSourceNodeId: undefined,
        selectedNodeId: undefined,
        drawer: undefined,
        runDrawerOpen: false,
        createWorkflowDrawerOpen: false,
        configDrawerOpen: true,
        saveError: undefined,
      }),
    openCreateWorkflowDrawer: () =>
      update({
        draftSourceNodeId: undefined,
        selectedNodeId: undefined,
        drawer: undefined,
        runDrawerOpen: false,
        configDrawerOpen: false,
        createWorkflowDrawerOpen: true,
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
          <WorkflowSwitcher
            disabled={state.saving}
            onCreate={state.openCreateWorkflowDrawer}
            onSelect={() => undefined}
            projects={state.projects}
            workflows={[]}
          />
          <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
            <div className="max-w-sm">
              <h2 className="text-[18px]/6 font-semibold tracking-[-0.01em]">
                Create your first workflow
              </h2>
              <p className="mt-2 text-sm/5 text-muted-foreground">
                Workflows keep each project process, graph, and run configuration independent.
              </p>
            </div>
          </div>
          {state.createWorkflowDrawerOpen ? (
            <WorkflowConfigDrawer
              error={state.saveError}
              mode="create"
              onClose={state.closeCreateWorkflowDrawer}
              onSubmit={state.createWorkflow}
              projects={state.projects}
              saving={state.saving}
              value={{
                name: '',
                description: '',
                configuration: { projectIds: [], primaryProjectId: null, variables: [] },
              }}
            />
          ) : null}
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
    <section
      aria-busy={state.switching}
      aria-label="Editor"
      className="relative flex h-full min-h-0 min-w-0 flex-col"
    >
      <WorkflowSwitcher
        disabled={state.saving || state.switching}
        onCreate={state.openCreateWorkflowDrawer}
        onSelect={(workflowId) => void state.selectWorkflow(workflowId)}
        projects={state.projects}
        selectedWorkflowId={state.workflow.workflowId}
        workflows={state.workflows}
      />
      {state.error === undefined ? null : (
        <Alert className="mx-4 mt-4" variant="destructive">
          <AlertTitle>Workflow not switched</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="relative min-h-0 flex-1">
        <WorkflowCanvas
          addAgentDisabledReason={state.addAgentDisabledReason}
          onAddAgent={state.openCreateDrawer}
          onConfigure={state.openConfigDrawer}
          onConnect={(source, target) => void state.connectAgents(source, target)}
          onEdgeDelete={(edge) => void state.deleteEdge(edge)}
          onNodeSelect={state.selectNode}
          onRun={state.openRunDrawer}
          runDisabledReason={state.runDisabledReason}
          runnable={state.runnable}
          selectedNodeId={state.selectedNodeId}
          workflow={state.canvasWorkflow}
        />
      </div>

      {state.drawer === undefined ? null : (
        <AgentDrawer
          key={state.drawer.kind === 'create' ? 'create-agent' : `edit-${state.drawer.agent.id}`}
          existingNodeIds={new Set(state.workflow.nodes.map(({ id }) => id))}
          harnessError={state.harnessError}
          harnesses={state.harnesses}
          mode={state.drawer}
          onClose={state.closeAgentDrawer}
          onDelete={state.deleteAgent}
          onSubmit={state.saveAgent}
          saveError={state.saveError}
          saving={state.saving}
        />
      )}

      {state.configDrawerOpen ? (
        <WorkflowConfigDrawer
          error={state.projectCatalogError ?? state.saveError}
          mode="edit"
          onClose={state.closeConfigDrawer}
          onSubmit={state.saveWorkflowConfiguration}
          projects={state.projects}
          saving={state.saving}
          value={{
            name: state.workflow.name,
            description: state.workflow.description,
            configuration: state.workflow.configuration,
          }}
        />
      ) : null}

      {state.createWorkflowDrawerOpen ? (
        <WorkflowConfigDrawer
          error={state.saveError}
          mode="create"
          onClose={state.closeCreateWorkflowDrawer}
          onSubmit={state.createWorkflow}
          projects={state.projects}
          saving={state.saving}
          value={{
            name: '',
            description: '',
            configuration: { projectIds: [], primaryProjectId: null, variables: [] },
          }}
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
