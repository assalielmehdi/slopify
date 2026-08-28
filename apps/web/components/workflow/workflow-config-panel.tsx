'use client'

import type { Repository } from '@slopify/contracts'
import {
  workflowToWorkflowFile,
  type Workflow,
  type WorkflowConfiguration,
} from '@slopify/workflow-model'
import { BracesIcon, FolderGit2Icon, PlusIcon, Settings2Icon, Trash2Icon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { useDeleteConfirmationDismissal } from '@/components/use-delete-confirmation-dismissal'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { WorkspacePanelHeader } from '@/components/workspace-panel-header'
import {
  WorkflowGraphJsonEditor,
  formatWorkflowGraphSource,
  parseWorkflowGraphSource,
} from '@/components/workflow/workflow-graph-json-editor'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface VariableRow {
  readonly id: string
  readonly name: string
}

export interface WorkflowConfigPanelProps {
  readonly value: Workflow
  readonly repositories: readonly Repository[]
  readonly conflict?: string | undefined
  readonly error?: string | undefined
  readonly saving?: boolean | undefined
  readonly onClose: () => void
  readonly onDelete: () => Promise<boolean>
  readonly onDirtyChange?: ((dirty: boolean) => void) | undefined
  readonly onSubmit: (value: Workflow) => Promise<boolean>
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

export function WorkflowConfigPanel({
  value,
  repositories,
  conflict,
  error,
  saving = false,
  onClose,
  onDelete,
  onDirtyChange,
  onSubmit,
}: WorkflowConfigPanelProps) {
  const { configuration } = value
  const workflowFile = workflowToWorkflowFile(value)
  const initialGraphSource = formatWorkflowGraphSource(workflowFile.graph)
  const confirmationInputRef = useRef<HTMLInputElement>(null)
  const deleteActionRef = useRef<HTMLButtonElement>(null)
  const nextVariableId = useRef(configuration.variables.length)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmationWorkflowId, setConfirmationWorkflowId] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [description, setDescription] = useState(value.description)
  const [graphSource, setGraphSource] = useState(initialGraphSource)
  const [selectedRepositoryIds, setSelectedRepositoryIds] = useState<
    Set<Repository['repositoryId']>
  >(() => new Set(configuration.repositoryIds))
  const [primaryRepositoryId, setPrimaryRepositoryId] = useState<
    WorkflowConfiguration['primaryRepositoryId']
  >(configuration.primaryRepositoryId)
  const [variables, setVariables] = useState<readonly VariableRow[]>(() =>
    configuration.variables.map((name, index) => ({ id: `variable-${index}`, name })),
  )

  const dismissDeleteConfirmation = useCallback(() => {
    setConfirmingDelete(false)
    setConfirmationWorkflowId('')
  }, [])

  useDeleteConfirmationDismissal({
    actionRef: deleteActionRef,
    active: confirmingDelete,
    confirmationRef: confirmationInputRef,
    disabled: deleting,
    onDismiss: dismissDeleteConfirmation,
  })

  const requestClose = () => {
    if (!saving && !deleting) onClose()
  }

  useEffect(() => {
    if (confirmingDelete) confirmationInputRef.current?.focus()
  }, [confirmingDelete])

  const trimmedVariables = variables.map(({ name }) => name.trim())
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
    trimmedDescription !== value.description ||
    !sameMembers(selectedRepositories, configuration.repositoryIds) ||
    primaryRepositoryId !== configuration.primaryRepositoryId ||
    !sameValues(trimmedVariables, configuration.variables) ||
    graphSource !== initialGraphSource
  const graphResult = parseWorkflowGraphSource(graphSource, workflowFile)
  const repositoriesValid =
    (selectedRepositories.length === 0 && primaryRepositoryId === null) ||
    (primaryRepositoryId !== null && selectedRepositories.includes(primaryRepositoryId))

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (
      trimmedDescription.length === 0 ||
      !variablesValid ||
      !repositoriesValid ||
      graphResult.status === 'INVALID' ||
      conflict !== undefined ||
      !isDirty
    )
      return
    const graph = graphResult.value
    const saved = await onSubmit({
      ...value,
      description: trimmedDescription,
      configuration: {
        repositoryIds: selectedRepositories,
        primaryRepositoryId,
        variables: trimmedVariables,
      },
      startNodeId: graph.startNodeId,
      nodes: graph.nodes,
      edges: graph.edges,
      maxTransitions: graph.maxTransitions,
    })
    if (!saved) return
    toast.add({
      title: 'Workflow saved',
      description: 'Details, repositories, run variables, and graph were saved.',
      type: 'success',
    })
    requestClose()
  }

  const deleteWorkflow = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    if (confirmationWorkflowId !== value.workflowId) return
    setDeleting(true)
    const deleted = await onDelete()
    setDeleting(false)
    if (!deleted) return
    toast.add({
      title: 'Workflow deleted',
      description: `${value.workflowId} was removed from Slopify.`,
      type: 'success',
    })
    requestClose()
  }

  return (
    <aside
      aria-label="Workflow configuration"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
      data-layout="workspace"
    >
      <WorkspacePanelHeader
        icon={Settings2Icon}
        subtitle="Update details and configuration shared by every agent."
        title="Edit workflow"
      />

      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submit(event)}>
        <div className="grid min-h-0 flex-1 content-start gap-8 overflow-y-auto p-6">
          {conflict === undefined ? null : (
            <Alert variant="destructive">
              <AlertTitle>External change detected</AlertTitle>
              <AlertDescription>{conflict}</AlertDescription>
            </Alert>
          )}
          {error === undefined ? null : (
            <Alert variant="destructive">
              <AlertTitle>Workflow action failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <section className="grid gap-3">
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

          <WorkflowGraphJsonEditor
            onChange={setGraphSource}
            source={graphSource}
            workflow={workflowFile}
          />

          <footer className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div
              aria-hidden={!confirmingDelete}
              className={cn(
                't-resize min-w-0 justify-self-end overflow-hidden',
                confirmingDelete ? 'w-full' : 'w-0',
              )}
            >
              <Input
                ref={confirmationInputRef}
                aria-label="Workflow ID confirmation"
                aria-invalid={
                  confirmationWorkflowId.length > 0 && confirmationWorkflowId !== value.workflowId
                }
                autoComplete="off"
                disabled={!confirmingDelete || deleting}
                onChange={(event) => setConfirmationWorkflowId(event.currentTarget.value)}
                placeholder="Enter workflow ID"
                tabIndex={confirmingDelete ? 0 : -1}
                value={confirmationWorkflowId}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                ref={deleteActionRef}
                className="min-w-32"
                disabled={
                  deleting || (confirmingDelete && confirmationWorkflowId !== value.workflowId)
                }
                onClick={() => void deleteWorkflow()}
                type="button"
                variant="destructive"
              >
                {deleting ? 'Deleting…' : confirmingDelete ? 'Confirm' : 'Delete'}
              </Button>
              <Button
                type="submit"
                disabled={
                  saving ||
                  deleting ||
                  trimmedDescription.length === 0 ||
                  !variablesValid ||
                  !repositoriesValid ||
                  graphResult.status === 'INVALID' ||
                  conflict !== undefined ||
                  !isDirty
                }
              >
                {saving ? 'Saving changes…' : 'Save changes'}
              </Button>
            </div>
          </footer>
        </div>
      </form>
    </aside>
  )
}
