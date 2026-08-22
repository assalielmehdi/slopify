'use client'

import { useEffect, useState } from 'react'
import type { ConnectionCatalogEntry } from '@slopify/contracts'

import {
  AgentNodeSchema,
  WorkflowEdgeSchema,
  isLinearAgentWorkflow,
  validateWorkflow,
  type AgentNode,
  type Workflow,
  type WorkflowEdge,
} from '@slopify/workflow-model'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { StartRunDrawer } from '@/components/runs/start-run-drawer'
import {
  createApiClient,
  type ApiClient,
  type ConnectionRecord,
  type SkillRecord,
} from '@/lib/api-client'
import { showUndoDeletionToast } from '@/lib/undo-deletion-toast'

import {
  AgentDrawer,
  createAgentId,
  type AgentDrawerMode,
  type AgentFormValue,
} from './agent-drawer'
import { WorkflowCanvas } from './workflow-canvas'

type WorkflowEditorClient = Pick<
  ApiClient,
  'getWorkflow' | 'listConnections' | 'listSkills' | 'listWorkflows' | 'startRun' | 'updateWorkflow'
>

export interface WorkflowWorkbenchProps {
  readonly client?: WorkflowEditorClient
}

const defaultClient = createApiClient()

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'The workflow could not be loaded'

export function WorkflowWorkbench({ client = defaultClient }: WorkflowWorkbenchProps) {
  const [workflow, setWorkflow] = useState<Workflow>()
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [drawer, setDrawer] = useState<AgentDrawerMode>()
  const [runDrawerOpen, setRunDrawerOpen] = useState(false)
  const [draftSourceNodeId, setDraftSourceNodeId] = useState<string>()
  const [connections, setConnections] = useState<readonly ConnectionRecord[]>([])
  const [connectionCatalog, setConnectionCatalog] = useState<readonly ConnectionCatalogEntry[]>([])
  const [skills, setSkills] = useState<readonly SkillRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [catalogError, setCatalogError] = useState<string>()
  const [saveError, setSaveError] = useState<string>()

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const workflows = await client.listWorkflows()
        const catalogEntry = workflows[0]
        if (catalogEntry === undefined) throw new Error('No workflows available')

        const [current, nextSkills, connectionCatalog] = await Promise.all([
          client.getWorkflow(catalogEntry.workflowId),
          client.listSkills().catch((cause: unknown) => {
            setCatalogError(errorMessage(cause))
            return [] as const
          }),
          client.listConnections().catch((cause: unknown) => {
            setCatalogError(errorMessage(cause))
            return { catalog: [], connections: [] } as const
          }),
        ])
        if (!active) return

        setWorkflow(current)
        setSkills(nextSkills)
        setConnectionCatalog(connectionCatalog.catalog)
        setConnections(connectionCatalog.connections)
      } catch (cause) {
        if (active) setError(errorMessage(cause))
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [client])

  if (workflow === undefined) {
    return (
      <section className="flex h-full w-full flex-col" aria-busy={loading} aria-label="Editor">
        {error === undefined ? (
          <div role="status" aria-label="Loading workflow" className="h-full">
            <Skeleton className="h-full min-h-136 w-full" />
          </div>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Workflow unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </section>
    )
  }

  const validation = validateWorkflow(workflow, { registeredCommandIds: new Set() })
  const runnable =
    validation.valid &&
    isLinearAgentWorkflow(workflow) &&
    workflow.nodes.length > 0 &&
    workflow.nodes.every(({ type }) => type === 'agent')

  const persist = async (next: Workflow) => {
    setSaving(true)
    setSaveError(undefined)
    try {
      const saved = await client.updateWorkflow(workflow.workflowId, next)
      setWorkflow(saved)
      return saved
    } catch (cause) {
      setSaveError(errorMessage(cause))
      return undefined
    } finally {
      setSaving(false)
    }
  }

  const selectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId)
    const agent = workflow.nodes.find(
      (node): node is AgentNode => node.type === 'agent' && node.id === nodeId,
    )
    if (agent !== undefined) {
      setDraftSourceNodeId(undefined)
      setDrawer({ kind: 'edit', agent })
      setSaveError(undefined)
    }
  }

  const saveAgent = async (value: AgentFormValue) => {
    const currentAgent =
      drawer?.kind === 'edit'
        ? workflow.nodes.find(
            (node): node is AgentNode => node.type === 'agent' && node.id === drawer.agent.id,
          )
        : undefined
    const agent = AgentNodeSchema.parse({
      ...(currentAgent ?? {}),
      type: 'agent',
      id: value.id,
      name: value.name,
      job: {
        kind: 'agent',
        prompt: value.prompt,
        inference: value.inference,
        connectorIds: value.connectorIds,
        skillSnapshotRefs: value.skillSnapshotRefs,
      },
    })
    const nextNodes =
      currentAgent === undefined
        ? [...workflow.nodes, agent]
        : workflow.nodes.map((node) => (node.id === currentAgent.id ? agent : node))
    const nextEdges =
      currentAgent === undefined && draftSourceNodeId !== undefined
        ? [
            ...workflow.edges,
            WorkflowEdgeSchema.parse({
              sourceNodeId: draftSourceNodeId,
              targetNodeId: agent.id,
              outcome: 'completed',
              label: 'Completed',
            }),
          ]
        : workflow.edges
    const saved = await persist({
      ...workflow,
      startNodeId: workflow.startNodeId ?? agent.id,
      nodes: nextNodes,
      edges: nextEdges,
    })
    if (saved !== undefined) {
      setSelectedNodeId(agent.id)
      setDraftSourceNodeId(undefined)
      return true
    }
    return false
  }

  const deleteAgent = async () => {
    if (drawer?.kind !== 'edit') return false
    const deletedAgent = workflow.nodes.find(
      (node): node is AgentNode => node.type === 'agent' && node.id === drawer.agent.id,
    )
    if (deletedAgent === undefined) return false

    const previousWorkflow = workflow
    const incomingEdge = workflow.edges.find((edge) => edge.targetNodeId === deletedAgent.id)
    const outgoingEdge = workflow.edges.find((edge) => edge.sourceNodeId === deletedAgent.id)
    const remainingNodes = workflow.nodes.filter((node) => node.id !== deletedAgent.id)
    const remainingNodeIds = new Set(remainingNodes.map(({ id }) => id))
    const nextStartNodeId =
      workflow.startNodeId !== deletedAgent.id
        ? workflow.startNodeId
        : (workflow.edges.find(
            (edge) =>
              edge.sourceNodeId === deletedAgent.id && remainingNodeIds.has(edge.targetNodeId),
          )?.targetNodeId ??
          remainingNodes[0]?.id ??
          null)
    const remainingEdges = workflow.edges.filter(
      (edge) => edge.sourceNodeId !== deletedAgent.id && edge.targetNodeId !== deletedAgent.id,
    )
    const saved = await persist({
      ...workflow,
      startNodeId: nextStartNodeId,
      nodes: remainingNodes,
      edges:
        incomingEdge === undefined || outgoingEdge === undefined
          ? remainingEdges
          : [
              ...remainingEdges,
              WorkflowEdgeSchema.parse({
                sourceNodeId: incomingEdge.sourceNodeId,
                targetNodeId: outgoingEdge.targetNodeId,
                outcome: 'completed',
                label: 'Completed',
              }),
            ],
    })
    if (saved === undefined) return false

    setSelectedNodeId(undefined)
    showUndoDeletionToast({
      receipt: { undoExpiresAt: new Date(Date.now() + 10_000).toISOString() },
      deletedTitle: 'Agent deleted',
      deletedDescription: `${deletedAgent.name} was removed from the workflow.`,
      restoredTitle: 'Agent restored',
      restoredDescription: `${deletedAgent.name} is available in the workflow again.`,
      async onUndo() {
        const restored = await client.updateWorkflow(previousWorkflow.workflowId, previousWorkflow)
        setWorkflow(restored)
      },
    })
    return true
  }

  const connectAgents = async (sourceNodeId: string, targetNodeId: string) => {
    if (
      sourceNodeId === targetNodeId ||
      targetNodeId === workflow.startNodeId ||
      workflow.edges.some((edge) => edge.sourceNodeId === sourceNodeId) ||
      workflow.edges.some((edge) => edge.targetNodeId === targetNodeId) ||
      workflow.edges.some(
        (edge) => edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId,
      )
    )
      return
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
    draftSourceNodeId === undefined
      ? undefined
      : createAgentId('New agent', new Set(workflow.nodes.map(({ id }) => id)))
  const draftSource = workflow.nodes.find(
    (node): node is AgentNode => node.type === 'agent' && node.id === draftSourceNodeId,
  )
  const canvasWorkflow =
    draftNodeId === undefined || draftSource === undefined
      ? workflow
      : {
          ...workflow,
          nodes: [
            ...workflow.nodes,
            AgentNodeSchema.parse({
              type: 'agent',
              id: draftNodeId,
              name: 'New agent',
              job: {
                kind: 'agent',
                prompt: 'Configure this agent.',
                inference: draftSource.job.inference,
                connectorIds: [],
                skillSnapshotRefs: [],
              },
            }),
          ],
          edges: [
            ...workflow.edges,
            WorkflowEdgeSchema.parse({
              sourceNodeId: draftSourceNodeId,
              targetNodeId: draftNodeId,
              outcome: 'completed',
              label: 'Completed',
            }),
          ],
        }

  const openCreateDrawer = (sourceNodeId?: string) => {
    if (
      sourceNodeId !== undefined &&
      workflow.edges.some((edge) => edge.sourceNodeId === sourceNodeId)
    )
      return
    setRunDrawerOpen(false)
    setDraftSourceNodeId(sourceNodeId)
    setSelectedNodeId(
      sourceNodeId === undefined
        ? undefined
        : createAgentId('New agent', new Set(workflow.nodes.map(({ id }) => id))),
    )
    setDrawer({ kind: 'create' })
    setSaveError(undefined)
  }

  const closeDrawer = () => {
    setDraftSourceNodeId(undefined)
    setSelectedNodeId(undefined)
    setDrawer(undefined)
  }

  const openRunDrawer = () => {
    closeDrawer()
    setRunDrawerOpen(true)
  }

  return (
    <section className="relative h-full min-h-0 min-w-0" aria-label="Editor">
      <WorkflowCanvas
        workflow={canvasWorkflow}
        selectedNodeId={selectedNodeId}
        onNodeSelect={selectNode}
        onAddAgent={openCreateDrawer}
        onConnect={(source, target) => void connectAgents(source, target)}
        onEdgeDelete={(edge) => void deleteEdge(edge)}
        onRun={openRunDrawer}
        runnable={runnable}
      />

      {drawer === undefined ? null : (
        <AgentDrawer
          key={drawer.kind === 'create' ? 'create-agent' : `edit-${drawer.agent.id}`}
          mode={drawer}
          existingNodeIds={new Set(workflow.nodes.map(({ id }) => id))}
          catalog={connectionCatalog}
          connections={connections}
          skills={skills}
          catalogError={catalogError}
          saveError={saveError}
          saving={saving}
          onDelete={deleteAgent}
          onClose={closeDrawer}
          onSubmit={saveAgent}
        />
      )}

      {runDrawerOpen ? (
        <StartRunDrawer client={client} onClose={() => setRunDrawerOpen(false)} />
      ) : null}
    </section>
  )
}
