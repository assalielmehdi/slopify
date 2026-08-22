'use client'

import type { Project } from '@slopify/contracts'
import { FolderGit2Icon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { createApiClient, type ApiClient } from '@/lib/api-client'
import { showUndoDeletionToast } from '@/lib/undo-deletion-toast'
import { cn } from '@/lib/utils'

type ProjectClient = Required<
  Pick<ApiClient, 'listProjects' | 'addProject' | 'deleteProject' | 'undoDeletion'>
>
type PanelSelection = 'add' | string

const defaultClient = createApiClient()

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const statusLabel = (availability: Project['availability']): string =>
  availability === 'AVAILABLE'
    ? 'Available'
    : availability === 'MISSING'
      ? "Can't find in file system"
      : 'Not a Git repository'

function ProjectStatus({ project }: Readonly<{ project: Project }>) {
  return (
    <Badge
      variant={project.availability === 'NOT_GIT_REPOSITORY' ? 'destructive' : 'secondary'}
      className={cn(
        'shrink-0 font-normal',
        project.availability === 'AVAILABLE' && 'bg-status-success/10 text-status-success',
        project.availability === 'MISSING' && 'text-muted-foreground',
      )}
    >
      {statusLabel(project.availability)}
    </Badge>
  )
}

function ProjectIcon() {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
      <FolderGit2Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
    </span>
  )
}

function ProjectTile({ onSelect, project }: Readonly<{ onSelect: () => void; project: Project }>) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={`${project.name}, ${statusLabel(project.availability)}`}
      onClick={onSelect}
      className={cn(
        'h-[140px] w-full flex-col items-stretch justify-start gap-0 overflow-hidden rounded-lg border border-border bg-card p-0 text-left whitespace-normal shadow-[var(--shadow-raised)] transition-[background-color,border-color,box-shadow,opacity] duration-150 hover:border-input hover:bg-accent/45 hover:shadow-[var(--shadow-raised-hover)] focus-visible:border-input',
        project.availability !== 'AVAILABLE' && 'bg-muted/20 opacity-60',
      )}
    >
      <span className="flex min-h-0 flex-1 items-start gap-3.5 p-4">
        <ProjectIcon />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate text-[14px]/5 font-semibold tracking-[-0.01em] text-foreground">
              {project.name}
            </span>
            <ProjectStatus project={project} />
          </span>
          <span className="text-[12px]/4 font-medium text-muted-foreground">
            Local Git repository
          </span>
          <span className="mt-1 truncate font-mono text-[12px]/5 font-normal text-muted-foreground">
            {project.repositoryPath}
          </span>
        </span>
      </span>
    </Button>
  )
}

export function ProjectSettings({
  client = defaultClient as ProjectClient,
}: Readonly<{ client?: ProjectClient }>) {
  const [projects, setProjects] = useState<readonly Project[]>([])
  const [selection, setSelection] = useState<PanelSelection>()
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmationPath, setConfirmationPath] = useState('')
  const [closingProject, setClosingProject] = useState<Project>()
  const [loading, setLoading] = useState(true)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelOpenFrameRef = useRef<number | undefined>(undefined)
  const confirmationInputRef = useRef<HTMLInputElement>(null)
  const selectedProject =
    projects.find(({ projectId }) => projectId === selection) ??
    (closingProject?.projectId === selection ? closingProject : undefined)

  const closePanel = useCallback(() => {
    if (panelOpenFrameRef.current !== undefined) {
      window.cancelAnimationFrame(panelOpenFrameRef.current)
      panelOpenFrameRef.current = undefined
    }
    setIsPanelOpen(false)
    setConfirmingDelete(false)
    setConfirmationPath('')
    if (prefersReducedMotion()) {
      setClosingProject(undefined)
      setSelection(undefined)
    }
  }, [])

  const openPanel = useCallback((nextSelection: PanelSelection) => {
    if (panelOpenFrameRef.current !== undefined)
      window.cancelAnimationFrame(panelOpenFrameRef.current)
    setSelection(nextSelection)
    setError(undefined)
    setConfirmingDelete(false)
    setConfirmationPath('')
    setClosingProject(undefined)
    setIsPanelOpen(false)

    if (prefersReducedMotion()) {
      setIsPanelOpen(true)
      panelOpenFrameRef.current = undefined
      return
    }

    panelOpenFrameRef.current = window.requestAnimationFrame(() => {
      panelOpenFrameRef.current = window.requestAnimationFrame(() => {
        setIsPanelOpen(true)
        panelOpenFrameRef.current = undefined
      })
    })
  }, [])

  useEffect(() => {
    let active = true
    void client
      .listProjects()
      .then((nextProjects) => {
        if (active) setProjects(nextProjects)
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Projects could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      if (panelOpenFrameRef.current !== undefined)
        window.cancelAnimationFrame(panelOpenFrameRef.current)
    }
  }, [client])

  useEffect(() => {
    if (!isPanelOpen) return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return
      closePanel()
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [closePanel, isPanelOpen])

  useEffect(() => {
    if (confirmingDelete) confirmationInputRef.current?.focus()
  }, [confirmingDelete])

  const addProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(undefined)
    const form = event.currentTarget
    const repositoryPath = String(new FormData(form).get('repositoryPath'))
    try {
      const project = await client.addProject({ repositoryPath })
      setProjects((current) => [...current, project])
      form.reset()
      closePanel()
      toast.add({
        title: 'Project added',
        description: `${project.name} is now available in Slopify.`,
        type: 'success',
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Project could not be added.')
    } finally {
      setSaving(false)
    }
  }

  const deleteProject = async (project: Project) => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    if (confirmationPath !== project.repositoryPath) return

    setDeleting(true)
    setError(undefined)
    try {
      const receipt = await client.deleteProject(project.projectId)
      setClosingProject(project)
      setProjects((current) => current.filter(({ projectId }) => projectId !== project.projectId))
      closePanel()
      showUndoDeletionToast({
        receipt,
        deletedTitle: 'Project deleted',
        deletedDescription: `${project.name} was removed from Slopify.`,
        restoredTitle: 'Project restored',
        restoredDescription: `${project.name} is available in Slopify again.`,
        async onUndo() {
          await client.undoDeletion(receipt.deletionId)
          setProjects(await client.listProjects())
        },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Project could not be deleted.')
    } finally {
      setDeleting(false)
    }
  }

  const panelTitle = selection === 'add' ? 'Add project' : selectedProject?.name

  return (
    <section aria-label="Projects" className="w-full px-6 pt-6 pb-10 sm:pb-12">
      <div className="mb-3 flex justify-end">
        <Button type="button" size="sm" onClick={() => openPanel('add')}>
          <PlusIcon aria-hidden="true" /> Add project
        </Button>
      </div>

      {error === undefined ? null : (
        <Alert variant="destructive" className="mb-3">
          <AlertTitle>Project unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div
        data-testid="project-grid"
        className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]"
      >
        {projects.map((project) => (
          <ProjectTile
            key={project.projectId}
            project={project}
            onSelect={() => openPanel(project.projectId)}
          />
        ))}
      </div>

      {loading ? (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          Loading projects…
        </p>
      ) : projects.length === 0 && error === undefined ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
          <p className="text-[14px]/5 font-semibold">No projects yet</p>
          <p className="mt-1 text-[13px]/5 text-muted-foreground">
            Add a local Git repository to make it available to workflows.
          </p>
        </div>
      ) : null}

      {panelTitle === undefined ? null : (
        <div
          ref={panelRef}
          data-testid="project-panel-shell"
          data-open={isPanelOpen}
          aria-hidden={!isPanelOpen}
          className="provider-floating-panel-shell fixed inset-y-3 right-3 z-30 w-[min(34rem,calc(100%-1.5rem))]"
          style={
            {
              '--panel-open-dur': '350ms',
              '--panel-close-dur': '350ms',
              '--panel-translate-y': '0px',
            } as CSSProperties
          }
          onTransitionEnd={(event) => {
            if (
              event.target === event.currentTarget &&
              event.propertyName === 'translate' &&
              !isPanelOpen
            ) {
              setClosingProject(undefined)
              setSelection(undefined)
            }
          }}
        >
          <aside
            role="dialog"
            aria-modal="false"
            aria-labelledby="project-panel-title"
            data-layout="floating"
            data-open={isPanelOpen}
            className="t-panel-slide flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-overlay)]"
          >
            <header className="relative shrink-0 border-b border-border p-6 pr-14">
              <div className="flex items-center gap-3">
                <ProjectIcon />
                <div className="min-w-0">
                  <h2
                    id="project-panel-title"
                    className="text-[18px]/6 font-semibold tracking-[-0.01em]"
                  >
                    {panelTitle}
                  </h2>
                  <p className="text-[12px]/4 text-muted-foreground">Local Git repository</p>
                </div>
                {selectedProject === undefined ? null : (
                  <div className="ml-auto">
                    <ProjectStatus project={selectedProject} />
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close project details"
                onClick={closePanel}
                className="absolute top-3 right-3"
              >
                <XIcon aria-hidden="true" />
              </Button>
            </header>

            <div className="grid min-h-0 gap-6 overflow-y-auto p-6">
              {selection === 'add' ? (
                <form className="grid gap-4" onSubmit={(event) => void addProject(event)}>
                  <Field>
                    <FieldLabel htmlFor="project-repository-path">Absolute local path</FieldLabel>
                    <Input
                      id="project-repository-path"
                      name="repositoryPath"
                      placeholder="/Users/you/workspace/repository"
                      autoComplete="off"
                      required
                    />
                    <FieldDescription>
                      The path must exist and point to the root of a local Git repository.
                    </FieldDescription>
                  </Field>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Checking repository…' : 'Add project'}
                  </Button>
                </form>
              ) : selectedProject === undefined ? null : (
                <>
                  <section className="grid gap-2">
                    <h2 className="text-[14px]/5 font-semibold">Repository path</h2>
                    <p className="break-all rounded-md border border-border bg-background p-3 font-mono text-[12px]/5 text-muted-foreground">
                      {selectedProject.repositoryPath}
                    </p>
                  </section>
                  <form
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void deleteProject(selectedProject)
                    }}
                  >
                    <div
                      aria-hidden={!confirmingDelete}
                      className={cn(
                        't-resize min-w-0 justify-self-end overflow-hidden',
                        confirmingDelete ? 'w-full' : 'w-0',
                      )}
                    >
                      <Input
                        ref={confirmationInputRef}
                        aria-describedby="project-delete-confirmation-hint"
                        aria-invalid={
                          confirmationPath.length > 0 &&
                          confirmationPath !== selectedProject.repositoryPath
                        }
                        autoComplete="off"
                        disabled={!confirmingDelete || deleting}
                        placeholder="Enter the repository path"
                        tabIndex={confirmingDelete ? 0 : -1}
                        value={confirmationPath}
                        onChange={(event) => setConfirmationPath(event.target.value)}
                      />
                    </div>
                    <span id="project-delete-confirmation-hint" className="sr-only">
                      Enter the full repository path exactly to enable deletion.
                    </span>
                    <Button
                      type="submit"
                      variant="destructive"
                      className="col-start-2 ml-auto min-w-32"
                      disabled={
                        deleting ||
                        (confirmingDelete && confirmationPath !== selectedProject.repositoryPath)
                      }
                    >
                      <Trash2Icon aria-hidden="true" />
                      {deleting ? 'Deleting…' : confirmingDelete ? 'Confirm' : 'Delete project'}
                    </Button>
                  </form>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  )
}
