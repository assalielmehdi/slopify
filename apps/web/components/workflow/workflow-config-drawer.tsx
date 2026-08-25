'use client'

import type { Repository } from '@slopify/contracts'
import type { CreateWorkflowInput, WorkflowConfiguration } from '@slopify/workflow-model'
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
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface VariableRow {
  readonly id: string
  readonly name: string
}

export interface WorkflowConfigDrawerProps {
  readonly value: CreateWorkflowInput
  readonly repositories: readonly Repository[]
  readonly error?: string | undefined
  readonly saving?: boolean | undefined
  readonly onClose: () => void
  readonly onDelete: () => Promise<boolean>
  readonly onSubmit: (value: CreateWorkflowInput) => Promise<boolean>
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

function WorkflowRepositoriesFields({
  onPrimaryRepositoryChange,
  onRepositoryToggle,
  primaryRepositoryId,
  repositories,
  selectedRepositoryIds,
}: Readonly<{
  onPrimaryRepositoryChange: (repositoryId: Repository['repositoryId']) => void
  onRepositoryToggle: (repository: Repository, selected: boolean) => void
  primaryRepositoryId: WorkflowConfiguration['primaryRepositoryId']
  repositories: readonly Repository[]
  selectedRepositoryIds: ReadonlySet<Repository['repositoryId']>
}>) {
  return (
    <section className="grid gap-3">
      <div className="flex items-start gap-3">
        <FolderGit2Icon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <h3 className="text-sm/5 font-semibold">Repositories</h3>
          <p className="mt-1 text-xs/4 text-muted-foreground">
            Every agent can work in each selected Git repository.
          </p>
        </div>
      </div>
      {repositories.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs/4 text-muted-foreground">
          No repositories are configured in Slopify yet.
        </p>
      ) : (
        <div className="grid gap-2">
          {repositories.map((repository) => {
            const selected = selectedRepositoryIds.has(repository.repositoryId)
            const unavailable = repository.availability !== 'AVAILABLE'
            return (
              <div
                className={cn(
                  'flex items-start gap-3 rounded-md border border-border p-3 transition-colors duration-[var(--duration-quick)] hover:bg-muted/40',
                  selected && 'border-foreground/25 bg-muted/55',
                  unavailable && !selected && 'opacity-60',
                )}
                key={repository.repositoryId}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 has-[:disabled]:cursor-not-allowed">
                  <input
                    checked={selected}
                    className="mt-0.5 size-4 rounded border-input accent-foreground"
                    disabled={unavailable && !selected}
                    onChange={(event) =>
                      onRepositoryToggle(repository, event.currentTarget.checked)
                    }
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm/5 font-medium">{repository.name}</span>
                    <span className="block break-all font-mono text-xs/4 text-muted-foreground">
                      {unavailable
                        ? `${repository.fullName} · ${repository.availability === 'CONNECTION_MISSING' ? 'Connection missing' : 'Repository unavailable'}`
                        : repository.fullName}
                    </span>
                  </span>
                </label>
                {selected ? (
                  <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs/4 font-medium text-muted-foreground">
                    <input
                      aria-label={`${repository.name} as primary repository`}
                      checked={primaryRepositoryId === repository.repositoryId}
                      className="size-4 border-input accent-foreground"
                      name="primary-repository"
                      onChange={() => onPrimaryRepositoryChange(repository.repositoryId)}
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
  value,
  repositories,
  error,
  saving = false,
  onClose,
  onDelete,
  onSubmit,
}: WorkflowConfigDrawerProps) {
  const { configuration } = value
  const shellRef = useRef<HTMLDivElement>(null)
  const openFrameRef = useRef<number | undefined>(undefined)
  const closeTimerRef = useRef<number | undefined>(undefined)
  const closingRef = useRef(false)
  const confirmationInputRef = useRef<HTMLInputElement>(null)
  const nextVariableId = useRef(configuration.variables.length)
  const [open, setOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmationName, setConfirmationName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [name, setName] = useState(value.name)
  const [description, setDescription] = useState(value.description)
  const [selectedRepositoryIds, setSelectedRepositoryIds] = useState<
    Set<Repository['repositoryId']>
  >(() => new Set(configuration.repositoryIds))
  const [primaryRepositoryId, setPrimaryRepositoryId] = useState<
    WorkflowConfiguration['primaryRepositoryId']
  >(configuration.primaryRepositoryId)
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
    if (closingRef.current || saving || deleting) return
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
  }, [completeClose, deleting, saving])

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
    if (confirmingDelete) confirmationInputRef.current?.focus()
  }, [confirmingDelete])

  const trimmedVariables = variables.map(({ name }) => name.trim())
  const trimmedName = name.trim()
  const trimmedDescription = description.trim()
  const variablesValid =
    trimmedVariables.every((name) => name.length > 0) &&
    new Set(trimmedVariables).size === trimmedVariables.length
  const selectedRepositories: Repository['repositoryId'][] = []
  for (const repository of repositories) {
    if (selectedRepositoryIds.has(repository.repositoryId))
      selectedRepositories.push(repository.repositoryId)
  }
  const isDirty =
    trimmedName !== value.name ||
    trimmedDescription !== value.description ||
    !sameMembers(selectedRepositories, configuration.repositoryIds) ||
    primaryRepositoryId !== configuration.primaryRepositoryId ||
    !sameValues(trimmedVariables, configuration.variables)
  const repositoriesValid =
    (selectedRepositories.length === 0 && primaryRepositoryId === null) ||
    (primaryRepositoryId !== null && selectedRepositories.includes(primaryRepositoryId))

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (
      trimmedName.length === 0 ||
      trimmedDescription.length === 0 ||
      !variablesValid ||
      !repositoriesValid ||
      !isDirty
    )
      return
    const saved = await onSubmit({
      name: trimmedName,
      description: trimmedDescription,
      configuration: {
        repositoryIds: selectedRepositories,
        primaryRepositoryId,
        variables: trimmedVariables,
      },
    })
    if (!saved) return
    toast.add({
      title: 'Workflow saved',
      description: 'Details, repositories, and run variables were saved.',
      type: 'success',
    })
    requestClose()
  }

  const deleteWorkflow = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    if (confirmationName !== value.name) return
    setDeleting(true)
    const deleted = await onDelete()
    setDeleting(false)
    if (!deleted) return
    toast.add({
      title: 'Workflow deleted',
      description: `${value.name} was removed from Slopify.`,
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
              <h2 className="text-[18px]/6 font-semibold tracking-[-0.01em]">Edit workflow</h2>
              <p className="text-xs/4 text-muted-foreground">
                Update details and configuration shared by every agent.
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
                <AlertTitle>Workflow action failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <section className="grid gap-3">
              <div>
                <h3 className="text-sm/5 font-semibold">Details</h3>
                <p className="mt-1 text-xs/4 text-muted-foreground">
                  Name and describe this workflow in the editor catalog.
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor="workflow-name">Name</FieldLabel>
                <Input
                  id="workflow-name"
                  onChange={(event) => setName(event.currentTarget.value)}
                  placeholder="release-workflow"
                  value={name}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="workflow-description">Description</FieldLabel>
                <Textarea
                  id="workflow-description"
                  onChange={(event) => setDescription(event.currentTarget.value)}
                  placeholder="What should this workflow coordinate?"
                  value={description}
                />
              </Field>
            </section>

            <WorkflowRepositoriesFields
              onPrimaryRepositoryChange={setPrimaryRepositoryId}
              onRepositoryToggle={(repository, selected) => {
                const next = new Set(selectedRepositoryIds)
                if (selected) next.add(repository.repositoryId)
                else next.delete(repository.repositoryId)
                setSelectedRepositoryIds(next)
                if (selected && primaryRepositoryId === null) {
                  setPrimaryRepositoryId(repository.repositoryId)
                } else if (!selected && primaryRepositoryId === repository.repositoryId) {
                  setPrimaryRepositoryId(
                    repositories.find(({ repositoryId }) => next.has(repositoryId))?.repositoryId ??
                      null,
                  )
                }
              }}
              primaryRepositoryId={primaryRepositoryId}
              repositories={repositories}
              selectedRepositoryIds={selectedRepositoryIds}
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

            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <div
                aria-hidden={!confirmingDelete}
                className={cn(
                  't-resize min-w-0 justify-self-end overflow-hidden',
                  confirmingDelete ? 'w-full' : 'w-0',
                )}
              >
                <Input
                  ref={confirmationInputRef}
                  aria-label="Workflow name confirmation"
                  aria-invalid={confirmationName.length > 0 && confirmationName !== value.name}
                  autoComplete="off"
                  disabled={!confirmingDelete || deleting}
                  onChange={(event) => setConfirmationName(event.currentTarget.value)}
                  placeholder="Enter workflow name"
                  tabIndex={confirmingDelete ? 0 : -1}
                  value={confirmationName}
                />
              </div>
              <Button
                className="col-start-2 ml-auto min-w-32"
                disabled={deleting || (confirmingDelete && confirmationName !== value.name)}
                onClick={() => void deleteWorkflow()}
                type="button"
                variant="destructive"
              >
                <Trash2Icon aria-hidden="true" />
                {deleting ? 'Deleting…' : confirmingDelete ? 'Confirm' : 'Delete workflow'}
              </Button>
            </div>

            <footer className="flex justify-end">
              <Button
                type="submit"
                disabled={
                  saving ||
                  deleting ||
                  trimmedName.length === 0 ||
                  trimmedDescription.length === 0 ||
                  !variablesValid ||
                  !repositoriesValid ||
                  !isDirty
                }
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
