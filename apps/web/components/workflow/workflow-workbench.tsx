'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useReducer, useRef } from 'react'

import type { HarnessDescriptor, Project } from '@slopify/contracts'
import {
  AgentNodeSchema,
  WorkflowEdgeSchema,
  type Workflow,
  type WorkflowConfiguration,
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
  'getWorkflow' | 'listHarnesses' | 'listProjects' | 'listWorkflows' | 'startRun' | 'updateWorkflow'
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
  const requestedWorkflowId = selectedWorkflowId

  useEffect(() => {
    let active = true
    const sequence = ++loadSequence.current

    const load = async () => {
      try {
        const workflows = await client.listWorkflows()
        const catalogEntry =
          workflows.find(({ workflowId }) => workflowId === requestedWorkflowId) ?? workflows[0]
        if (catalogEntry === undefined) throw new Error('No workflows available')
        activeWorkflowId.current = catalogEntry.workflowId
        if (requestedWorkflowId !== catalogEntry.workflowId) {
          router.replace(`/?workflowId=${encodeURIComponent(catalogEntry.workflowId)}`)
        }

        const [current, harnesses, projects] = await Promise.all([
          client.getWorkflow(catalogEntry.workflowId),
          client.listHarnesses().catch((cause: unknown) => {
            if (active) update({ harnessError: errorMessage(cause) })
            return [] as readonly HarnessDescriptor[]
          }),
          client.listProjects().catch((cause: unknown) => {
            if (active) update({ projectCatalogError: errorMessage(cause) })
            return [] as const
          }),
        ])
        if (!active || sequence !== loadSequence.current) return
        update({ workflow: current, workflows, harnesses, projects, error: undefined })
      } catch (cause) {
        if (active && sequence === loadSequence.current) update({ error: errorMessage(cause) })
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
    return { ready: false as const, error: state.error, loading: state.loading }
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
      if (activeWorkflowId.current === saved.workflowId) update({ workflow: saved })
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

  const saveWorkflowConfiguration = async (configuration: WorkflowConfiguration) =>
    (await persist({ ...workflow, configuration })) !== undefined

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
      error: undefined,
      saveError: undefined,
    })
    router.push(`/?workflowId=${encodeURIComponent(workflowId)}`)
    try {
      const selected = await client.getWorkflow(workflowId)
      if (sequence !== loadSequence.current || activeWorkflowId.current !== workflowId) return
      update({ workflow: selected })
    } catch (cause) {
      if (sequence === loadSequence.current) update({ error: errorMessage(cause) })
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
    selectWorkflow,
    closeConfigDrawer: () => update({ configDrawerOpen: false }),
    closeRunDrawer: () => update({ runDrawerOpen: false }),
    openCreateDrawer: (sourceNodeId?: string) => {
      if (addAgentDisabledReason !== undefined) return
      update({
        runDrawerOpen: false,
        configDrawerOpen: false,
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
        runDrawerOpen: true,
      })
    },
    openConfigDrawer: () =>
      update({
        draftSourceNodeId: undefined,
        selectedNodeId: undefined,
        drawer: undefined,
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
        onSelect={(workflowId) => void state.selectWorkflow(workflowId)}
        projects={state.projects}
        selectedWorkflowId={state.workflow.workflowId}
        workflows={state.workflows}
      />
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
          configuration={state.workflow.configuration}
          error={state.projectCatalogError ?? state.saveError}
          onClose={state.closeConfigDrawer}
          onSubmit={state.saveWorkflowConfiguration}
          projects={state.projects}
          saving={state.saving}
        />
      ) : null}

      {state.runDrawerOpen ? (
        <StartRunDrawer client={client} onClose={state.closeRunDrawer} />
      ) : null}
    </section>
  )
}
