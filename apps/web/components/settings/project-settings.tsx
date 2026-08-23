'use client'

import type { Project } from '@slopify/contracts'
import { FolderGit2Icon, Trash2Icon, XIcon } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type CSSProperties,
  type RefObject,
} from 'react'

import { CatalogToolbar } from '@/components/settings/catalog-toolbar'
import { CatalogCardSkeleton } from '@/components/settings/catalog-card-skeleton'
import { CatalogCardTags } from '@/components/settings/catalog-card-tags'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { createApiClient, type ApiClient } from '@/lib/api-client'
import { showUndoDeletionToast } from '@/lib/undo-deletion-toast'
import { cn } from '@/lib/utils'

type ProjectClient = Required<
  Pick<ApiClient, 'listProjects' | 'addProject' | 'deleteProject' | 'undoDeletion'>
>
type PanelSelection = 'add' | string

interface ProjectSettingsState {
  readonly projects: readonly Project[]
  readonly selection: PanelSelection | undefined
  readonly isPanelOpen: boolean
  readonly error: string | undefined
  readonly saving: boolean
  readonly deleting: boolean
  readonly confirmingDelete: boolean
  readonly confirmationPath: string
  readonly searchQuery: string
  readonly closingProject: Project | undefined
  readonly loading: boolean
}

type ProjectSettingsUpdate =
  Partial<ProjectSettingsState> | ((state: ProjectSettingsState) => Partial<ProjectSettingsState>)

const initialProjectSettingsState: ProjectSettingsState = {
  projects: [],
  selection: undefined,
  isPanelOpen: false,
  error: undefined,
  saving: false,
  deleting: false,
  confirmingDelete: false,
  confirmationPath: '',
  searchQuery: '',
  closingProject: undefined,
  loading: true,
}

const updateProjectSettings = (
  state: ProjectSettingsState,
  update: ProjectSettingsUpdate,
): ProjectSettingsState => ({
  ...state,
  ...(typeof update === 'function' ? update(state) : update),
})

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
        'h-auto min-h-[140px] w-full flex-col items-stretch justify-start gap-0 overflow-hidden rounded-lg border border-border bg-card p-0 text-left whitespace-normal shadow-[var(--shadow-raised)] transition-[background-color,border-color,box-shadow,opacity] duration-150 hover:border-input hover:bg-accent/45 hover:shadow-[var(--shadow-raised-hover)] focus-visible:border-input',
        project.availability !== 'AVAILABLE' && 'bg-muted/20 opacity-60',
      )}
    >
      <span className="flex min-h-0 flex-1 items-start gap-3.5 p-4">
        <ProjectIcon />
        <span className="flex min-w-0 flex-1 self-stretch flex-col gap-1">
          <span className="truncate text-[14px]/5 font-semibold tracking-[-0.01em] text-foreground">
            {project.name}
          </span>
          <span className="text-[12px]/4 font-medium text-muted-foreground">
            Local Git repository
          </span>
          <span className="mt-1 truncate font-mono text-[12px]/5 font-normal text-muted-foreground">
            {project.repositoryPath}
          </span>
          <CatalogCardTags>
            <ProjectStatus project={project} />
          </CatalogCardTags>
        </span>
      </span>
    </Button>
  )
}

function ProjectPanel({
  confirmationInputRef,
  confirmationPath,
  confirmingDelete,
  deleting,
  isOpen,
  onAdd,
  onClose,
  onConfirmationPathChange,
  onDelete,
  onExited,
  panelRef,
  panelTitle,
  saving,
  selectedProject,
  selection,
}: Readonly<{
  confirmationInputRef: RefObject<HTMLInputElement | null>
  confirmationPath: string
  confirmingDelete: boolean
  deleting: boolean
  isOpen: boolean
  onAdd: (formData: FormData) => Promise<void>
  onClose: () => void
  onConfirmationPathChange: (value: string) => void
  onDelete: () => Promise<void>
  onExited: () => void
  panelRef: RefObject<HTMLDivElement | null>
  panelTitle: string
  saving: boolean
  selectedProject: Project | undefined
  selection: PanelSelection | undefined
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.show === 'function') dialog.show()
      else dialog.setAttribute('open', '')
    }
    return () => {
      if (!dialog?.open) return
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [])

  return (
    <div
      ref={panelRef}
      aria-hidden={!isOpen}
      className="floating-panel-shell fixed inset-y-3 right-3 left-3 z-30 w-auto sm:left-auto sm:w-[min(34rem,calc(100%-1.5rem))]"
      data-open={isOpen}
      data-testid="project-panel-shell"
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'translate' && !isOpen) {
          onExited()
        }
      }}
      style={
        {
          '--panel-open-dur': '350ms',
          '--panel-close-dur': '350ms',
          '--panel-translate-y': '0px',
        } as CSSProperties
      }
    >
      <dialog
        ref={dialogRef}
        aria-labelledby="project-panel-title"
        aria-modal="false"
        className="t-panel-slide relative m-0 flex h-full max-h-none w-full max-w-none flex-col overflow-hidden rounded-xl border border-border bg-card p-0 text-card-foreground shadow-[var(--shadow-overlay)]"
        data-layout="floating"
        data-open={isOpen}
      >
        <header className="relative shrink-0 border-b border-border p-6 pr-14">
          <div className="flex items-center gap-3">
            <ProjectIcon />
            <div className="min-w-0">
              <h2
                className="text-[18px]/6 font-semibold tracking-[-0.01em]"
                id="project-panel-title"
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
            aria-label="Close project details"
            className="absolute top-3 right-3"
            onClick={onClose}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </header>

        <div className="grid min-h-0 gap-6 overflow-y-auto p-6">
          {selection === 'add' ? (
            <form action={onAdd} className="grid gap-4">
              <Field>
                <FieldLabel htmlFor="project-repository-path">Absolute local path</FieldLabel>
                <Input
                  autoComplete="off"
                  id="project-repository-path"
                  name="repositoryPath"
                  placeholder="/Users/you/workspace/repository"
                  required
                />
                <FieldDescription>
                  The path must exist and point to the root of a local Git repository.
                </FieldDescription>
              </Field>
              <Button disabled={saving} type="submit">
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
                    aria-describedby="project-delete-confirmation-hint"
                    aria-invalid={
                      confirmationPath.length > 0 &&
                      confirmationPath !== selectedProject.repositoryPath
                    }
                    autoComplete="off"
                    disabled={!confirmingDelete || deleting}
                    onChange={(event) => onConfirmationPathChange(event.target.value)}
                    placeholder="Enter the repository path"
                    tabIndex={confirmingDelete ? 0 : -1}
                    value={confirmationPath}
                  />
                </div>
                <span className="sr-only" id="project-delete-confirmation-hint">
                  Enter the full repository path exactly to enable deletion.
                </span>
                <Button
                  className="col-start-2 ml-auto min-w-32"
                  disabled={
                    deleting ||
                    (confirmingDelete && confirmationPath !== selectedProject.repositoryPath)
                  }
                  onClick={() => void onDelete()}
                  type="button"
                  variant="destructive"
                >
                  <Trash2Icon aria-hidden="true" />
                  {deleting ? 'Deleting…' : confirmingDelete ? 'Confirm' : 'Delete project'}
                </Button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  )
}

export function ProjectSettings({
  client = defaultClient as ProjectClient,
}: Readonly<{ client?: ProjectClient }>) {
  const [state, update] = useReducer(updateProjectSettings, initialProjectSettingsState)
  const {
    projects,
    selection,
    isPanelOpen,
    error,
    saving,
    deleting,
    confirmingDelete,
    confirmationPath,
    searchQuery,
    closingProject,
    loading,
  } = state
  const panelRef = useRef<HTMLDivElement>(null)
  const panelOpenFrameRef = useRef<number | undefined>(undefined)
  const confirmationInputRef = useRef<HTMLInputElement>(null)
  const selectedProject =
    projects.find(({ projectId }) => projectId === selection) ??
    (closingProject?.projectId === selection ? closingProject : undefined)
  const visibleProjects = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    if (query === '') return projects
    return projects.filter(
      ({ name, repositoryPath }) =>
        name.toLocaleLowerCase().includes(query) ||
        repositoryPath.toLocaleLowerCase().includes(query),
    )
  }, [projects, searchQuery])

  const closePanel = useCallback(() => {
    if (panelOpenFrameRef.current !== undefined) {
      window.cancelAnimationFrame(panelOpenFrameRef.current)
      panelOpenFrameRef.current = undefined
    }
    update({ isPanelOpen: false, confirmingDelete: false, confirmationPath: '' })
    if (prefersReducedMotion()) {
      update({ closingProject: undefined, selection: undefined })
    }
  }, [])

  const openPanel = useCallback((nextSelection: PanelSelection) => {
    if (panelOpenFrameRef.current !== undefined)
      window.cancelAnimationFrame(panelOpenFrameRef.current)
    update({
      selection: nextSelection,
      error: undefined,
      confirmingDelete: false,
      confirmationPath: '',
      closingProject: undefined,
      isPanelOpen: false,
    })

    if (prefersReducedMotion()) {
      update({ isPanelOpen: true })
      panelOpenFrameRef.current = undefined
      return
    }

    panelOpenFrameRef.current = window.requestAnimationFrame(() => {
      panelOpenFrameRef.current = window.requestAnimationFrame(() => {
        update({ isPanelOpen: true })
        panelOpenFrameRef.current = undefined
      })
    })
  }, [])

  useEffect(() => {
    let active = true
    void client
      .listProjects()
      .then((nextProjects) => {
        if (active) update({ projects: nextProjects })
      })
      .catch((cause: unknown) => {
        if (active)
          update({
            error: cause instanceof Error ? cause.message : 'Projects could not be loaded.',
          })
      })
      .finally(() => {
        if (active) update({ loading: false })
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

  const addProject = async (formData: FormData) => {
    update({ saving: true, error: undefined })
    const repositoryPath = String(formData.get('repositoryPath'))
    try {
      const project = await client.addProject({ repositoryPath })
      update((current) => ({ projects: [...current.projects, project] }))
      closePanel()
      toast.add({
        title: 'Project added',
        description: `${project.name} is now available in Slopify.`,
        type: 'success',
      })
    } catch (cause) {
      update({ error: cause instanceof Error ? cause.message : 'Project could not be added.' })
    } finally {
      update({ saving: false })
    }
  }

  const deleteProject = async (project: Project) => {
    if (!confirmingDelete) {
      update({ confirmingDelete: true })
      return
    }
    if (confirmationPath !== project.repositoryPath) return

    update({ deleting: true, error: undefined })
    try {
      const receipt = await client.deleteProject(project.projectId)
      update((current) => ({
        closingProject: project,
        projects: current.projects.filter(({ projectId }) => projectId !== project.projectId),
      }))
      closePanel()
      showUndoDeletionToast({
        receipt,
        deletedTitle: 'Project deleted',
        deletedDescription: `${project.name} was removed from Slopify.`,
        restoredTitle: 'Project restored',
        restoredDescription: `${project.name} is available in Slopify again.`,
        async onUndo() {
          await client.undoDeletion(receipt.deletionId)
          update({ projects: await client.listProjects() })
        },
      })
    } catch (cause) {
      update({ error: cause instanceof Error ? cause.message : 'Project could not be deleted.' })
    } finally {
      update({ deleting: false })
    }
  }

  const panelTitle = selection === 'add' ? 'Add project' : selectedProject?.name

  return (
    <section aria-label="Projects" className="w-full px-6 pt-6 pb-10 sm:pb-12">
      <CatalogToolbar
        singular="project"
        plural="projects"
        query={searchQuery}
        onQueryChange={(query) => update({ searchQuery: query })}
        onAdd={() => openPanel('add')}
      />

      {error === undefined ? null : (
        <Alert variant="destructive" className="mb-3">
          <AlertTitle>Project unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <CatalogCardSkeleton label="projects" />
      ) : (
        <div
          data-testid="project-grid"
          className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]"
        >
          {visibleProjects.map((project) => (
            <ProjectTile
              key={project.projectId}
              project={project}
              onSelect={() => openPanel(project.projectId)}
            />
          ))}
        </div>
      )}

      {loading ? null : projects.length === 0 && error === undefined ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
          <p className="text-[14px]/5 font-semibold">No projects yet</p>
          <p className="mt-1 text-[13px]/5 text-muted-foreground">
            Add a local Git repository to make it available to workflows.
          </p>
        </div>
      ) : visibleProjects.length === 0 && error === undefined ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
          <p className="text-[14px]/5 font-semibold">No matching projects</p>
          <p className="mt-1 text-[13px]/5 text-muted-foreground">
            Try a different name or repository path.
          </p>
        </div>
      ) : null}

      {panelTitle === undefined ? null : (
        <ProjectPanel
          confirmationInputRef={confirmationInputRef}
          confirmationPath={confirmationPath}
          confirmingDelete={confirmingDelete}
          deleting={deleting}
          isOpen={isPanelOpen}
          onAdd={addProject}
          onClose={closePanel}
          onConfirmationPathChange={(value) => update({ confirmationPath: value })}
          onDelete={() =>
            selectedProject === undefined ? Promise.resolve() : deleteProject(selectedProject)
          }
          onExited={() => update({ closingProject: undefined, selection: undefined })}
          panelRef={panelRef}
          panelTitle={panelTitle}
          saving={saving}
          selectedProject={selectedProject}
          selection={selection}
        />
      )}
    </section>
  )
}
