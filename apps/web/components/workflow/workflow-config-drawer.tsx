'use client'

import type { Project } from '@slopify/contracts'
import type { WorkflowConfiguration } from '@slopify/workflow-model'
import {
  BracesIcon,
  FolderGit2Icon,
  PlusIcon,
  Settings2Icon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface VariableRow {
  readonly id: string
  readonly name: string
}

export interface WorkflowConfigDrawerProps {
  readonly configuration: WorkflowConfiguration
  readonly projects: readonly Project[]
  readonly error?: string | undefined
  readonly saving?: boolean | undefined
  readonly onClose: () => void
  readonly onSubmit: (configuration: WorkflowConfiguration) => Promise<boolean>
}

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const durationMilliseconds = (value: string): number => {
  const trimmed = value.trim()
  if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed)
  if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1_000
  return 350
}

const sameValues = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

const sameMembers = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false
  const rightMembers = new Set(right)
  return left.every((value) => rightMembers.has(value))
}

function WorkflowProjectsFields({
  onPrimaryProjectChange,
  onProjectToggle,
  primaryProjectId,
  projects,
  selectedProjectIds,
}: Readonly<{
  onPrimaryProjectChange: (projectId: Project['projectId']) => void
  onProjectToggle: (project: Project, selected: boolean) => void
  primaryProjectId: WorkflowConfiguration['primaryProjectId']
  projects: readonly Project[]
  selectedProjectIds: ReadonlySet<Project['projectId']>
}>) {
  return (
    <section className="grid gap-3">
      <div className="flex items-start gap-3">
        <FolderGit2Icon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <h3 className="text-sm/5 font-semibold">Projects</h3>
          <p className="mt-1 text-xs/4 text-muted-foreground">
            Every agent can work in each selected Git repository.
          </p>
        </div>
      </div>
      {projects.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs/4 text-muted-foreground">
          No projects are configured in Slopify yet.
        </p>
      ) : (
        <div className="grid gap-2">
          {projects.map((project) => {
            const selected = selectedProjectIds.has(project.projectId)
            const unavailable = project.availability !== 'AVAILABLE'
            return (
              <div
                className={cn(
                  'flex items-start gap-3 rounded-md border border-border p-3 transition-colors duration-[var(--duration-quick)] hover:bg-muted/40',
                  selected && 'border-foreground/25 bg-muted/55',
                  unavailable && !selected && 'opacity-60',
                )}
                key={project.projectId}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 has-[:disabled]:cursor-not-allowed">
                  <input
                    checked={selected}
                    className="mt-0.5 size-4 rounded border-input accent-foreground"
                    disabled={unavailable && !selected}
                    onChange={(event) => onProjectToggle(project, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm/5 font-medium">{project.name}</span>
                    <span className="block break-all font-mono text-xs/4 text-muted-foreground">
                      {unavailable
                        ? `${project.repositoryPath} · Can't find in file system`
                        : project.repositoryPath}
                    </span>
                  </span>
                </label>
                {selected ? (
                  <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs/4 font-medium text-muted-foreground">
                    <input
                      aria-label={`${project.name} as primary project`}
                      checked={primaryProjectId === project.projectId}
                      className="size-4 border-input accent-foreground"
                      name="primary-project"
                      onChange={() => onPrimaryProjectChange(project.projectId)}
                      type="radio"
                    />
                    Primary
                  </label>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function WorkflowVariableFields({
  onAdd,
  onChange,
  onRemove,
  variables,
}: Readonly<{
  onAdd: () => void
  onChange: (id: string, name: string) => void
  onRemove: (id: string) => void
  variables: readonly VariableRow[]
}>) {
  return (
    <section className="grid gap-3">
      <div className="flex items-start gap-3">
        <BracesIcon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <h3 className="text-sm/5 font-semibold">Variables</h3>
          <p className="mt-1 text-xs/4 text-muted-foreground">
            Runs request one value for every name declared here.
          </p>
        </div>
      </div>

      {variables.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs/4 text-muted-foreground">
          This workflow has no run variables.
        </p>
      ) : (
        <div className="grid gap-2">
          {variables.map((variable, index) => (
            <div className="flex items-start gap-2" key={variable.id}>
              <Field className="min-w-0 flex-1">
                <FieldLabel className="sr-only" htmlFor={variable.id}>
                  Variable name {index + 1}
                </FieldLabel>
                <Input
                  aria-label={`Variable name ${index + 1}`}
                  id={variable.id}
                  maxLength={128}
                  onChange={(event) => onChange(variable.id, event.currentTarget.value)}
                  placeholder="Variable name"
                  value={variable.name}
                />
              </Field>
              <Button
                aria-label={`Remove variable ${variable.name || index + 1}`}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive dark:hover:bg-destructive/20"
                onClick={() => onRemove(variable.id)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          className="border-0 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onAdd}
          size="sm"
          type="button"
          variant="ghost"
        >
          <PlusIcon aria-hidden="true" /> Add variable
        </Button>
      </div>
    </section>
  )
}

export function WorkflowConfigDrawer({
  configuration,
  projects,
  error,
  saving = false,
  onClose,
  onSubmit,
}: WorkflowConfigDrawerProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const openFrameRef = useRef<number | undefined>(undefined)
  const closeTimerRef = useRef<number | undefined>(undefined)
  const closingRef = useRef(false)
  const nextVariableId = useRef(configuration.variables.length)
  const [open, setOpen] = useState(false)
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<Project['projectId']>>(
    () => new Set(configuration.projectIds),
  )
  const [primaryProjectId, setPrimaryProjectId] = useState<
    WorkflowConfiguration['primaryProjectId']
  >(configuration.primaryProjectId)
  const [variables, setVariables] = useState<readonly VariableRow[]>(() =>
    configuration.variables.map((name, index) => ({ id: `variable-${index}`, name })),
  )

  const completeClose = useCallback(() => {
    if (!closingRef.current) return
    closingRef.current = false
    if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = undefined
    onClose()
  }, [onClose])

  const requestClose = useCallback(() => {
    if (closingRef.current || saving) return
    closingRef.current = true
    setOpen(false)
    if (prefersReducedMotion()) {
      completeClose()
      return
    }
    const duration = durationMilliseconds(
      getComputedStyle(shellRef.current ?? document.documentElement).getPropertyValue(
        '--panel-close-dur',
      ),
    )
    closeTimerRef.current = window.setTimeout(completeClose, duration + 50)
  }, [completeClose, saving])

  useEffect(() => {
    openFrameRef.current = window.requestAnimationFrame(() => {
      openFrameRef.current = window.requestAnimationFrame(() => setOpen(true))
    })
    return () => {
      if (openFrameRef.current !== undefined) window.cancelAnimationFrame(openFrameRef.current)
      if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  const trimmedVariables = variables.map(({ name }) => name.trim())
  const variablesValid =
    trimmedVariables.every((name) => name.length > 0) &&
    new Set(trimmedVariables).size === trimmedVariables.length
  const selectedProjects: Project['projectId'][] = []
  for (const project of projects) {
    if (selectedProjectIds.has(project.projectId)) selectedProjects.push(project.projectId)
  }
  const isDirty =
    !sameMembers(selectedProjects, configuration.projectIds) ||
    primaryProjectId !== configuration.primaryProjectId ||
    !sameValues(trimmedVariables, configuration.variables)
  const projectsValid =
    (selectedProjects.length === 0 && primaryProjectId === null) ||
    (primaryProjectId !== null && selectedProjects.includes(primaryProjectId))

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!variablesValid || !projectsValid || !isDirty) return
    const saved = await onSubmit({
      projectIds: selectedProjects,
      primaryProjectId,
      variables: trimmedVariables,
    })
    if (!saved) return
    toast.add({
      title: 'Workflow configuration saved',
      description: 'Projects and run variables are available to every agent in this workflow.',
      type: 'success',
    })
    requestClose()
  }

  return (
    <div
      ref={shellRef}
      data-open={open}
      className="floating-panel-shell fixed top-[4.25rem] right-3 bottom-3 left-3 z-30 isolate w-auto sm:left-auto sm:w-[min(34rem,calc(100%-1.5rem))]"
      style={{ '--panel-translate-y': '0px' } as CSSProperties}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'translate' && !open) {
          completeClose()
        }
      }}
    >
      <aside
        aria-label="Workflow configuration"
        data-open={open}
        className="t-panel-slide flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-overlay)]"
      >
        <header className="relative shrink-0 border-b border-border p-6 pr-14">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
              <Settings2Icon aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[18px]/6 font-semibold tracking-[-0.01em]">
                Workflow configuration
              </h2>
              <p className="text-xs/4 text-muted-foreground">
                Configure resources and inputs shared by every agent.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close workflow configuration"
            onClick={requestClose}
            className="absolute top-3 right-3"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </header>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submit(event)}>
          <div className="grid min-h-0 flex-1 content-start gap-8 overflow-y-auto p-6">
            {error === undefined ? null : (
              <Alert variant="destructive">
                <AlertTitle>Workflow configuration not saved</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <WorkflowProjectsFields
              onPrimaryProjectChange={setPrimaryProjectId}
              onProjectToggle={(project, selected) => {
                const next = new Set(selectedProjectIds)
                if (selected) next.add(project.projectId)
                else next.delete(project.projectId)
                setSelectedProjectIds(next)
                if (selected && primaryProjectId === null) {
                  setPrimaryProjectId(project.projectId)
                } else if (!selected && primaryProjectId === project.projectId) {
                  setPrimaryProjectId(
                    projects.find(({ projectId }) => next.has(projectId))?.projectId ?? null,
                  )
                }
              }}
              primaryProjectId={primaryProjectId}
              projects={projects}
              selectedProjectIds={selectedProjectIds}
            />

            <WorkflowVariableFields
              onAdd={() => {
                nextVariableId.current += 1
                setVariables((current) => [
                  ...current,
                  { id: `variable-${nextVariableId.current}`, name: '' },
                ])
              }}
              onChange={(id, name) =>
                setVariables((current) =>
                  current.map((row) => (row.id === id ? { ...row, name } : row)),
                )
              }
              onRemove={(id) => setVariables((current) => current.filter((row) => row.id !== id))}
              variables={variables}
            />

            <footer className="flex justify-end">
              <Button
                type="submit"
                disabled={saving || !variablesValid || !projectsValid || !isDirty}
              >
                {saving ? 'Saving changes…' : 'Save changes'}
              </Button>
            </footer>
          </div>
        </form>
      </aside>
    </div>
  )
}
