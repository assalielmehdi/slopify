'use client'

import Link from 'next/link'

import { RunConfigurationFields } from '@/components/runs/run-configuration-fields'
import { useStartRun } from '@/components/runs/use-start-run'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createApiClient, type ApiClient } from '@/lib/api-client'

const defaultClient = createApiClient()

export interface StartRunFormProps {
  readonly client?: ApiClient
}

export function StartRunForm({ client = defaultClient }: StartRunFormProps) {
  const state = useStartRun(client)

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
          aria-label="Start a run"
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]"
          onSubmit={(event) => {
            event.preventDefault()
            void state.start(state.missingVariables.length > 0)
          }}
        >
          <Card>
            <CardContent>
              <RunConfigurationFields
                onAddVariable={state.addVariable}
                onRemoveVariable={state.removeVariable}
                onVariableKeyChange={(id, key) => state.changeVariable(id, 'key', key)}
                onVariableValueChange={(id, value) => state.changeVariable(id, 'value', value)}
                onWorkflowChange={state.changeWorkflow}
                rows={state.rows}
                workflowId={state.workflowId}
                workflows={state.workflows}
              />
            </CardContent>
          </Card>

          <aside className="grid gap-4 xl:sticky xl:top-20">
            {state.error?.scope === 'start' ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {state.error.activeRunId === undefined
                    ? 'Run not started'
                    : 'Another run is active'}
                </AlertTitle>
                <AlertDescription>
                  <p>{state.error.message}</p>
                  {state.error.activeRunId === undefined ? null : (
                    <Link href={`/runs/${state.error.activeRunId}`}>
                      Open active run {state.error.activeRunId}
                    </Link>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            {state.missingVariables.length === 0 ? null : (
              <Alert className="border-status-warning/35 bg-status-warning/10">
                <AlertTitle>Missing prompt variables</AlertTitle>
                <AlertDescription>
                  <p>Starting anyway substitutes an empty value for each missing variable.</p>
                  <ul className="mt-2 list-inside list-disc font-mono text-xs/4">
                    {state.missingVariables.map((variable) => (
                      <li key={variable}>{variable}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {state.startedRun === undefined ? null : (
              <Alert>
                <AlertTitle>Run started</AlertTitle>
                <AlertDescription>
                  <Link href={`/runs/${state.startedRun.runId}`}>
                    Open run {state.startedRun.runId}
                  </Link>
                </AlertDescription>
              </Alert>
            )}

            <Card>
              <CardContent className="grid gap-3">
                <p className="text-sm/5 text-muted-foreground">
                  The selected workflow and variables are snapshotted when the run starts.
                </p>
                {state.runnable ? null : (
                  <p className="text-sm/5 text-status-warning">
                    This workflow has no agent jobs and cannot be run.
                  </p>
                )}
                <Button className="w-full" disabled={!state.canStart} type="submit">
                  {state.starting
                    ? 'Starting…'
                    : state.missingVariables.length > 0
                      ? 'Start without missing variables'
                      : 'Start run'}
                </Button>
              </CardContent>
            </Card>
          </aside>
        </form>
      )}
    </section>
  )
}
