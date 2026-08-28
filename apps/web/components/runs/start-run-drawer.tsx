'use client'

import { useRouter } from 'next/navigation'
import { PlayIcon, XIcon } from 'lucide-react'

import { RunConfigurationFields } from '@/components/runs/run-configuration-fields'
import { type StartRunClient, useStartRun } from '@/components/runs/use-start-run'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { WorkspacePanelHeader } from '@/components/workspace-panel-header'

export interface StartRunDrawerProps {
  readonly client: StartRunClient
  readonly onClose: () => void
  readonly onStarted?: ((runId: string) => void) | undefined
  readonly workflowId: string
}

export function StartRunDrawer({ client, onClose, onStarted, workflowId }: StartRunDrawerProps) {
  const router = useRouter()
  const state = useStartRun(client, { initialWorkflowId: workflowId, requireInitialWorkflow: true })

  const requestClose = () => {
    if (!state.starting) onClose()
  }

  const submit = async () => {
    const run = await state.start()
    if (run === undefined) return
    onStarted?.(run.runId)
    router.push(`/runs/${run.runId}`)
  }

  return (
    <aside
      aria-label="Run"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
      data-layout="workspace"
    >
      <WorkspacePanelHeader
        action={
          <Button
            aria-label="Close run configuration"
            className="absolute top-3 right-3"
            onClick={requestClose}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon aria-hidden="true" />
          </Button>
        }
        icon={PlayIcon}
        subtitle="Provide the workflow variables, then start the run."
        title="Run workflow"
      />

      <form action={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto p-6">
          {state.loading ? (
            <p className="text-xs/4 text-muted-foreground">Loading variables…</p>
          ) : state.error?.scope === 'load' ? (
            <Alert variant="destructive">
              <AlertTitle>Run configuration unavailable</AlertTitle>
              <AlertDescription>{state.error.message}</AlertDescription>
            </Alert>
          ) : state.workflows.length === 0 ? (
            <Alert variant="destructive">
              <AlertTitle>Run unavailable</AlertTitle>
              <AlertDescription>A workflow is required before a run can start.</AlertDescription>
            </Alert>
          ) : (
            <>
              {state.error?.scope !== 'start' ? null : (
                <Alert variant="destructive">
                  <AlertTitle>Run not started</AlertTitle>
                  <AlertDescription>{state.error.message}</AlertDescription>
                </Alert>
              )}

              {state.runDisabledReason === undefined ? null : (
                <Alert className="border-status-warning/35 bg-status-warning/10">
                  <AlertTitle>Run unavailable</AlertTitle>
                  <AlertDescription>{state.runDisabledReason}</AlertDescription>
                </Alert>
              )}

              <RunConfigurationFields
                onVariableValueChange={state.changeVariable}
                onWorkflowChange={state.changeWorkflow}
                rows={state.rows}
                workflowId={state.workflowId}
                workflows={state.workflows}
                showWorkflowSelector={false}
                trailingAction={
                  <Button disabled={!state.canStart} type="submit">
                    {state.starting ? 'Starting…' : 'Start run'}
                  </Button>
                }
              />
            </>
          )}
        </div>
      </form>
    </aside>
  )
}
