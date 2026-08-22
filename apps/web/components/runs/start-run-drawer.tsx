'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PlayIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'

import { RunConfigurationFields } from '@/components/runs/run-configuration-fields'
import { type StartRunClient, useStartRun } from '@/components/runs/use-start-run'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { displayRunId } from '@/lib/run-id'

export interface StartRunDrawerProps {
  readonly client: StartRunClient
  readonly onClose: () => void
  readonly onStarted?: ((runId: string) => void) | undefined
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const durationMilliseconds = (value: string) => {
  const trimmed = value.trim()
  if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed)
  if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1_000
  return 350
}

export function StartRunDrawer({ client, onClose, onStarted }: StartRunDrawerProps) {
  const router = useRouter()
  const state = useStartRun(client)
  const shellRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef(false)
  const closeTimerRef = useRef<number | undefined>(undefined)
  const openFrameRef = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)

  const completeClose = useCallback(() => {
    if (!closingRef.current) return
    closingRef.current = false
    if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current)
    onClose()
  }, [onClose])

  const requestClose = useCallback(() => {
    if (closingRef.current || state.starting) return
    closingRef.current = true
    setOpen(false)
    if (prefersReducedMotion()) return completeClose()
    const duration = durationMilliseconds(
      getComputedStyle(shellRef.current ?? document.documentElement).getPropertyValue(
        '--panel-close-dur',
      ),
    )
    closeTimerRef.current = window.setTimeout(completeClose, duration + 50)
  }, [completeClose, state.starting])

  useEffect(() => {
    openFrameRef.current = window.requestAnimationFrame(() => {
      openFrameRef.current = window.requestAnimationFrame(() => setOpen(true))
    })
    return () => {
      if (openFrameRef.current !== undefined) window.cancelAnimationFrame(openFrameRef.current)
      if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (state.startedRun === undefined) return
    onStarted?.(state.startedRun.runId)
    router.push(`/runs/${state.startedRun.runId}`)
  }, [onStarted, router, state.startedRun])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void state.start(state.missingVariables.length > 0)
  }

  return (
    <div
      ref={shellRef}
      data-open={open}
      className="provider-floating-panel-shell fixed inset-y-3 right-3 left-3 z-30 isolate w-auto sm:absolute sm:left-auto sm:w-[min(34rem,calc(100%-1.5rem))]"
      style={
        {
          '--panel-open-dur': '350ms',
          '--panel-close-dur': '350ms',
          '--panel-translate-y': '0px',
        } as CSSProperties
      }
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'translate' && !open)
          completeClose()
      }}
    >
      <aside
        role="complementary"
        aria-label="Run"
        data-open={open}
        className="t-panel-slide flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-overlay)]"
      >
        <header className="relative shrink-0 border-b border-border p-6 pr-14">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
              <PlayIcon aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[18px]/6 font-semibold tracking-[-0.01em]">Run</h2>
              <p className="text-xs/4 text-muted-foreground">
                Add the variables this run needs, then start it.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close run drawer"
            onClick={requestClose}
            className="absolute top-3 right-3"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </header>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
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
                    <AlertTitle>
                      {state.error.activeRunId ? 'Another run is active' : 'Run not started'}
                    </AlertTitle>
                    <AlertDescription>
                      <p>{state.error.message}</p>
                      {state.error.activeRunId ? (
                        <Link href={`/runs/${state.error.activeRunId}`}>
                          Open active run {displayRunId(state.error.activeRunId)}
                        </Link>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                )}

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

                <RunConfigurationFields
                  onAddVariable={state.addVariable}
                  onRemoveVariable={state.removeVariable}
                  onVariableKeyChange={(id, key) => state.changeVariable(id, 'key', key)}
                  onVariableValueChange={(id, value) => state.changeVariable(id, 'value', value)}
                  onWorkflowChange={state.changeWorkflow}
                  rows={state.rows}
                  workflowId={state.workflowId}
                  workflows={state.workflows}
                  showWorkflowSelector={false}
                  trailingAction={
                    <Button disabled={!state.canStart} type="submit">
                      {state.starting
                        ? 'Starting…'
                        : state.missingVariables.length > 0
                          ? 'Start without missing variables'
                          : 'Start run'}
                    </Button>
                  }
                />
              </>
            )}
          </div>
        </form>
      </aside>
    </div>
  )
}
