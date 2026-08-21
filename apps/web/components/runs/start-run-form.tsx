'use client'

import Link from 'next/link'

import { RunConfigurationFields } from '@/components/runs/run-configuration-fields'
import { TaskConfirmation } from '@/components/runs/task-confirmation'
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
    <main className="flex w-full flex-col gap-6">
      {state.error?.scope === 'load' ? (
        <Alert variant="destructive">
          <AlertTitle>Run configuration unavailable</AlertTitle>
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      ) : state.catalog === undefined ||
        state.catalog.profiles.length === 0 ||
        state.workflows.length === 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Run configuration incomplete</AlertTitle>
          <AlertDescription>
            A valid workflow revision and project profile are required.
          </AlertDescription>
        </Alert>
      ) : (
        <form
          aria-label="Start a run"
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]"
          onSubmit={(event) => {
            event.preventDefault()
            void state.start()
          }}
        >
          <div className="grid gap-6">
            <Card>
              <CardContent>
                <RunConfigurationFields
                  catalog={state.catalog}
                  notes={state.notes}
                  onNotesChange={state.setNotes}
                  onProfileChange={(profileId) => void state.selectProfile(profileId)}
                  onResolveTask={() => void state.resolveTask()}
                  onRevisionChange={state.changeRevision}
                  onTaskReferenceChange={state.changeTaskReference}
                  onWorkflowChange={state.changeWorkflow}
                  profileError={state.profileError}
                  profileId={state.profileId}
                  readinessPending={state.readinessPending}
                  resolving={state.resolving}
                  revisionError={
                    state.error?.scope === 'revision' ? state.error.message : undefined
                  }
                  revisionId={state.revisionId}
                  selectedWorkflow={state.selectedWorkflow}
                  taskError={state.error?.scope === 'task' ? state.error.message : undefined}
                  taskReference={state.taskReference}
                  taskLocked={state.usesDefaultTask}
                  workflowId={state.workflowId}
                  workflows={state.workflows}
                />
              </CardContent>
            </Card>

            {state.task === undefined ||
            state.selectedProfile === undefined ||
            state.selectedWorkflow === undefined ? null : (
              <TaskConfirmation
                confirmed={state.confirmed}
                onConfirmedChange={state.setConfirmed}
                profile={state.selectedProfile}
                profileReady={state.readiness?.ready === true}
                revisionId={state.revisionId}
                task={state.task}
                workflowName={state.selectedWorkflow.name}
              />
            )}
          </div>

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
                  The selected revision and profile are snapshotted when the run starts.
                </p>
                <Button className="w-full" disabled={!state.canStart} type="submit">
                  {state.starting ? 'Starting…' : 'Start confirmed run'}
                </Button>
              </CardContent>
            </Card>
          </aside>
        </form>
      )}
    </main>
  )
}
