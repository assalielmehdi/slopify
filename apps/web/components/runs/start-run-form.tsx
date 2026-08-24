'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { RunConfigurationFields } from '@/components/runs/run-configuration-fields'
import { useStartRun } from '@/components/runs/use-start-run'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createApiClient, type ApiClient } from '@/lib/api-client'
import { displayRunId } from '@/lib/run-id'

const defaultClient = createApiClient()

export interface StartRunFormProps {
  readonly client?: ApiClient
  readonly initialWorkflowId?: string | undefined
}

export function StartRunForm({ client = defaultClient, initialWorkflowId }: StartRunFormProps) {
  const router = useRouter()
  const state = useStartRun(client, { initialWorkflowId })

  if (state.loading) {
    return <p className="text-xs text-muted-foreground">Loading run configuration…</p>
  }

  return (
    <section className="flex w-full flex-col gap-6">
      {state.error?.scope === 'load' ? (
        <Alert variant="destructive">
          <AlertTitle>Run configuration unavailable</AlertTitle>
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      ) : state.workflows.length === 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Run configuration incomplete</AlertTitle>
          <AlertDescription>A workflow is required before a run can start.</AlertDescription>
        </Alert>
      ) : (
        <form
          action={async () => {
            await state.start()
          }}
          aria-label="Start a run"
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]"
        >
          <Card>
            <CardContent>
              <RunConfigurationFields
                onVariableValueChange={state.changeVariable}
                onWorkflowChange={(workflowId) => {
                  state.changeWorkflow(workflowId)
                  router.replace(`/runs/new?workflowId=${encodeURIComponent(workflowId)}`)
                }}
                rows={state.rows}
                workflowId={state.workflowId}
                workflows={state.workflows}
              />
            </CardContent>
          </Card>

          <aside className="grid gap-4 xl:sticky xl:top-20">
            {state.error?.scope === 'start' ? (
              <Alert variant="destructive">
                <AlertTitle>Run not started</AlertTitle>
                <AlertDescription>{state.error.message}</AlertDescription>
              </Alert>
            ) : null}

            {state.startedRun === undefined ? null : (
              <Alert>
                <AlertTitle>Run started</AlertTitle>
                <AlertDescription>
                  <Link href={`/runs/${state.startedRun.runId}`}>
                    Open run {displayRunId(state.startedRun.runId)}
                  </Link>
                </AlertDescription>
              </Alert>
            )}

            <Card>
              <CardContent className="grid gap-3">
                <p className="text-sm/5 text-muted-foreground">
                  The selected workflow and variables are snapshotted when the run starts.
                </p>
                {state.runDisabledReason === undefined ? null : (
                  <p className="text-sm/5 text-status-warning">{state.runDisabledReason}</p>
                )}
                <Button className="w-full" disabled={!state.canStart} type="submit">
                  {state.starting ? 'Starting…' : 'Start run'}
                </Button>
              </CardContent>
            </Card>
          </aside>
        </form>
      )}
    </section>
  )
}
