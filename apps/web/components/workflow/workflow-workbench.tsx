'use client'

import type { WorkflowRevision } from '@loop/workflow-model'
import { PlayIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  createApiClient,
  type ApiClient,
  type ConnectionRecord,
  type SkillRecord,
  type WorkflowAgentConfigurationChanges,
  type WorkflowCatalogEntry,
} from '@/lib/api-client'

import { NodeInspector } from './node-inspector'
import { WorkflowCanvas } from './workflow-canvas'

type WorkflowInspectionClient = Pick<
  ApiClient,
  'createWorkflowRevision' | 'getWorkflowRevision' | 'listWorkflows'
> &
  Partial<Pick<ApiClient, 'listSkills' | 'listConnections'>>

export interface WorkflowWorkbenchProps {
  readonly client?: WorkflowInspectionClient
  readonly createRevisionId?: () => string
}

const defaultClient = createApiClient()
const defaultRevisionId = () => `revision-${crypto.randomUUID()}`

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'The workflow could not be loaded'

export function WorkflowWorkbench({
  client = defaultClient,
  createRevisionId = defaultRevisionId,
}: WorkflowWorkbenchProps) {
  const [catalog, setCatalog] = useState<readonly WorkflowCatalogEntry[]>([])
  const [revision, setRevision] = useState<WorkflowRevision>()
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [skills, setSkills] = useState<readonly SkillRecord[]>([])
  const [connections, setConnections] = useState<readonly ConnectionRecord[]>([])

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const [workflows, nextSkills, nextConnections] = await Promise.all([
          client.listWorkflows(),
          client.listSkills?.() ?? Promise.resolve([]),
          client.listConnections?.() ?? Promise.resolve([]),
        ])
        const workflow = workflows[0]
        if (workflow === undefined) throw new Error('No workflow revisions available')

        const latest = await client.getWorkflowRevision(
          workflow.workflowId,
          workflow.latestRevisionId,
        )
        if (!active) return

        setCatalog(workflows)
        setSkills(nextSkills)
        setConnections(nextConnections)
        setRevision(latest)
        setSelectedNodeId(latest.startNodeId)
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

  const selectRevision = async (revisionId: string) => {
    const workflow = catalog[0]
    if (workflow === undefined || revisionId === revision?.revisionId) return

    setLoading(true)
    setError(undefined)
    try {
      const selected = await client.getWorkflowRevision(workflow.workflowId, revisionId)
      setRevision(selected)
      setSelectedNodeId(selected.startNodeId)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  const saveAgentConfiguration = async (
    nodeId: string,
    changes: WorkflowAgentConfigurationChanges,
  ) => {
    const workflow = catalog[0]
    if (workflow === undefined || revision === undefined) {
      throw new Error('No workflow revision available')
    }

    setLoading(true)
    try {
      const created = await client.createWorkflowRevision(workflow.workflowId, {
        parentRevisionId: revision.revisionId,
        revisionId: createRevisionId(),
        updates: [{ nodeId, changes }],
      })
      setCatalog((current) =>
        current.map((entry) =>
          entry.workflowId === created.workflowId
            ? {
                ...entry,
                latestRevisionId: created.revisionId,
                revisions: [
                  {
                    revisionId: created.revisionId,
                    parentRevisionId: created.parentRevisionId ?? null,
                    createdAt: created.createdAt,
                  },
                  ...entry.revisions.filter(({ revisionId }) => revisionId !== created.revisionId),
                ],
              }
            : entry,
        ),
      )
      setRevision(created)
      setSelectedNodeId(nodeId)
    } finally {
      setLoading(false)
    }
  }

  if (revision === undefined) {
    return (
      <section className="flex w-full flex-col gap-4" aria-busy={loading} aria-label="Editor">
        {error === undefined ? (
          <div role="status" aria-label="Loading workflow">
            <Skeleton className="h-160 w-full" />
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

  const workflow = catalog[0]
  const selectedNode = revision.nodes.find(({ id }) => id === selectedNodeId) ?? revision.nodes[0]

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-busy={loading} aria-label="Editor">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border bg-card p-3 shadow-xs">
        <div className="flex flex-wrap items-end gap-3">
          <Badge variant="outline" className="mb-2">
            Read-only topology
          </Badge>
          <div className="grid gap-1.5">
            <label htmlFor="workflow-revision" className="text-xs/4 font-medium">
              Workflow revision
            </label>
            <Select
              items={
                workflow?.revisions.map(({ revisionId }) => ({
                  label: revisionId,
                  value: revisionId,
                })) ?? []
              }
              value={revision.revisionId}
              onValueChange={(value) => {
                if (value !== null) void selectRevision(value)
              }}
              disabled={loading}
            >
              <SelectTrigger id="workflow-revision" aria-label="Workflow revision">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  {workflow?.revisions.map((summary) => (
                    <SelectItem key={summary.revisionId} value={summary.revisionId}>
                      <span className="font-mono">{summary.revisionId}</span>
                      <span className="text-muted-foreground">
                        {summary.createdAt.slice(0, 10)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="grid gap-1 text-right">
            <span className="text-xs/4 font-medium text-muted-foreground">Transition limit</span>
            <span className="font-mono text-sm/5 tabular-nums">{revision.maxTransitions}</span>
          </div>
          <Link href="/runs/new" className={buttonVariants()}>
            <PlayIcon aria-hidden="true" /> New run
          </Link>
        </div>
      </div>

      {error === undefined ? null : (
        <Alert variant="destructive">
          <AlertTitle>Revision unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <WorkflowCanvas
          revision={revision}
          selectedNodeId={selectedNode?.id ?? revision.startNodeId}
          onNodeSelect={setSelectedNodeId}
        />
        {selectedNode === undefined ? null : (
          <aside aria-label="Selected node details" className="xl:sticky xl:top-18">
            <NodeInspector
              node={selectedNode}
              revisionId={revision.revisionId}
              isStart={selectedNode.id === revision.startNodeId}
              outgoingEdges={revision.edges.filter(
                ({ sourceNodeId }) => sourceNodeId === selectedNode.id,
              )}
              onSaveAgentConfiguration={(changes) =>
                saveAgentConfiguration(selectedNode.id, changes)
              }
              skills={skills}
              connections={connections}
            />
          </aside>
        )}
      </div>
    </section>
  )
}
