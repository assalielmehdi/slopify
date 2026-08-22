'use client'

import { PlayIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import type { Workflow } from '@loop/workflow-model'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { createApiClient, type ApiClient } from '@/lib/api-client'

import { WorkflowCanvas } from './workflow-canvas'

type WorkflowInspectionClient = Pick<ApiClient, 'getWorkflow' | 'listWorkflows'>

export interface WorkflowWorkbenchProps {
  readonly client?: WorkflowInspectionClient
}

const defaultClient = createApiClient()

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'The workflow could not be loaded'

export function WorkflowWorkbench({ client = defaultClient }: WorkflowWorkbenchProps) {
  const [workflow, setWorkflow] = useState<Workflow>()
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const workflows = await client.listWorkflows()
        const catalogEntry = workflows[0]
        if (catalogEntry === undefined) throw new Error('No workflows available')

        const current = await client.getWorkflow(catalogEntry.workflowId)
        if (!active) return

        setWorkflow(current)
        setSelectedNodeId(current.nodes.find(({ type }) => type === 'agent')?.id)
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

  const runnable = workflow.nodes.some(({ type }) => type === 'agent')

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-3" aria-label="Editor">
      <Card size="sm" className="shrink-0">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[18px]/6 font-semibold tracking-[-0.01em]">{workflow.name}</h1>
            <p className="mt-1 max-w-[72ch] text-sm/5 text-muted-foreground">
              {workflow.description}
            </p>
          </div>
          {runnable ? (
            <Link href="/runs/new" className={buttonVariants()}>
              <PlayIcon aria-hidden="true" /> New run
            </Link>
          ) : (
            <Button disabled>
              <PlayIcon aria-hidden="true" /> New run
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="min-h-0 flex-1">
        <WorkflowCanvas
          workflow={workflow}
          selectedNodeId={selectedNodeId}
          onNodeSelect={setSelectedNodeId}
        />
      </div>
    </section>
  )
}
