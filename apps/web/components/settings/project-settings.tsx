'use client'

import type { GitConnection, GitProvider, GitRepository, Project } from '@slopify/contracts'
import { FolderGit2Icon, Trash2Icon, XIcon } from 'lucide-react'
import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type RefObject,
} from 'react'

import { CatalogCardSkeleton } from '@/components/settings/catalog-card-skeleton'
import { CatalogCardTags } from '@/components/settings/catalog-card-tags'
import { CatalogToolbar } from '@/components/settings/catalog-toolbar'
import { GitProviderLogo } from '@/components/settings/git-provider-logo'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createApiClient, type ApiClient } from '@/lib/api-client'
import { buttonVariants } from '@/lib/button-variants'
import { showUndoDeletionToast } from '@/lib/undo-deletion-toast'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

type ProjectClient = Pick<
  ApiClient,
  | 'addProject'
  | 'deleteProject'
  | 'listGitConnections'
  | 'listGitRepositories'
  | 'listProjects'
  | 'undoDeletion'
>

const defaultClient = createApiClient()

const providerLabel = (provider: GitProvider): string =>
  provider === 'GITHUB' ? 'GitHub' : 'GitLab'

const statusLabel = (availability: Project['availability']): string =>
  availability === 'AVAILABLE'
    ? 'Available'
    : availability === 'CONNECTION_MISSING'
      ? 'Connection missing'
      : 'Repository unavailable'

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function ProjectIcon({ provider }: Readonly<{ provider?: GitProvider }>) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
      {provider === undefined ? (
        <FolderGit2Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
      ) : (
        <GitProviderLogo aria-hidden="true" className="size-5" provider={provider} />
      )}
    </span>
  )
}

function ProjectStatus({ project }: Readonly<{ project: Project }>) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'shrink-0 font-normal',
        project.availability === 'AVAILABLE' && 'bg-status-success/10 text-status-success',
        project.availability === 'CONNECTION_MISSING' && 'bg-status-warning/10 text-status-warning',
        project.availability === 'REPOSITORY_UNAVAILABLE' &&
          'bg-status-danger/10 text-status-danger',
      )}
    >
      {statusLabel(project.availability)}
    </Badge>
  )
}

function ProjectTile({ onSelect, project }: Readonly<{ onSelect: () => void; project: Project }>) {
  return (
    <Button
      aria-label={`${project.name}, ${statusLabel(project.availability)}`}
      className={cn(
        'h-auto min-h-[140px] w-full flex-col items-stretch justify-start gap-0 overflow-hidden rounded-lg border border-border bg-card p-0 text-left whitespace-normal shadow-[var(--shadow-raised)] transition-[background-color,border-color,box-shadow,opacity] duration-150 hover:border-input hover:bg-accent/45 hover:shadow-[var(--shadow-raised-hover)] focus-visible:border-input',
        project.availability !== 'AVAILABLE' && 'bg-muted/20 opacity-70',
      )}
      onClick={onSelect}
      type="button"
      variant="ghost"
    >
      <span className="flex min-h-0 flex-1 items-start gap-3.5 p-4">
        <ProjectIcon provider={project.provider} />
        <span className="flex min-w-0 flex-1 self-stretch flex-col gap-1">
          <span className="truncate text-[14px]/5 font-semibold tracking-[-0.01em] text-foreground">
            {project.name}
          </span>
          <span className="text-[12px]/4 font-medium text-muted-foreground">
            {providerLabel(project.provider)} repository
          </span>
          <span className="mt-1 truncate font-mono text-[12px]/5 font-normal text-muted-foreground">
            {project.fullName}
          </span>
          <CatalogCardTags>
            <ProjectStatus project={project} />
          </CatalogCardTags>
        </span>
      </span>
    </Button>
  )
}

interface ProjectPanelProps {
  readonly connections: readonly GitConnection[]
  readonly confirmingDelete: boolean
  readonly confirmationValue: string
  readonly deleting: boolean
  readonly isOpen: boolean
  readonly loadingRepositories: boolean
  readonly onAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>
  readonly onClose: () => void
  readonly onConfirmationValueChange: (value: string) => void
  readonly onDelete: () => Promise<void>
  readonly onExited: () => void
  readonly onProviderChange: (provider: GitProvider) => void
  readonly onRepositoryChange: (remoteId: string) => void
  readonly panelRef: RefObject<HTMLDivElement | null>
  readonly repositories: readonly GitRepository[]
  readonly saving: boolean
  readonly selectedProject: Project | undefined
  readonly selectedProvider: GitProvider | undefined
  readonly selectedRepositoryId: string | undefined
  readonly selection: 'add' | string | undefined
}

function ProjectPanel(props: ProjectPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const confirmationInputRef = useRef<HTMLInputElement>(null)
  const panelTitle = props.selection === 'add' ? 'Add project' : props.selectedProject?.name
  const selectedRepository = props.repositories.find(
    ({ remoteId }) => remoteId === props.selectedRepositoryId,
  )
  const [repositoryInputValue, setRepositoryInputValue] = useState('')

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

  useEffect(() => {
    if (props.confirmingDelete) confirmationInputRef.current?.focus()
  }, [props.confirmingDelete])

  useEffect(() => {
    setRepositoryInputValue(selectedRepository?.fullName ?? '')
  }, [selectedRepository])

  if (panelTitle === undefined) return null

  return (
    <div
      ref={props.panelRef}
      aria-hidden={!props.isOpen}
      className="floating-panel-shell fixed top-[4.25rem] right-3 bottom-3 left-3 z-30 w-auto sm:left-auto sm:w-[min(34rem,calc(100%-1.5rem))]"
      data-open={props.isOpen}
      data-testid="project-panel-shell"
      onTransitionEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.propertyName === 'translate' &&
          !props.isOpen
        ) {
          props.onExited()
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
        data-open={props.isOpen}
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
              <p className="text-[12px]/4 text-muted-foreground">
                {props.selectedProject === undefined
                  ? 'GitHub or GitLab repository'
                  : `${providerLabel(props.selectedProject.provider)} · ${props.selectedProject.fullName}`}
              </p>
            </div>
            {props.selectedProject === undefined ? null : (
              <div className="ml-auto">
                <ProjectStatus project={props.selectedProject} />
              </div>
            )}
          </div>
          <Button
            aria-label="Close project details"
            className="absolute top-3 right-3"
            onClick={props.onClose}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </header>

        <div className="grid min-h-0 gap-6 overflow-y-auto p-6">
          {props.selection === 'add' ? (
            <form className="grid gap-4" onSubmit={(event) => void props.onAdd(event)}>
              <Field>
                <FieldLabel htmlFor="project-provider">Provider</FieldLabel>
                <Select
                  onValueChange={(value) => {
                    if (value !== null) props.onProviderChange(value as GitProvider)
                  }}
                  value={props.selectedProvider ?? null}
                >
                  <SelectTrigger className="w-full" id="project-provider">
                    <SelectValue placeholder="Select a provider">
                      {props.selectedProvider === undefined
                        ? undefined
                        : providerLabel(props.selectedProvider)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    {props.connections.map(({ provider }) => (
                      <SelectItem key={provider} value={provider}>
                        {providerLabel(provider)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="project-repository">Repository</FieldLabel>
                <Combobox
                  disabled={props.loadingRepositories || props.repositories.length === 0}
                  isItemEqualToValue={(repository, value) => repository.remoteId === value.remoteId}
                  items={props.repositories}
                  itemToStringLabel={(repository) => repository.fullName}
                  itemToStringValue={(repository) => repository.remoteId}
                  inputValue={repositoryInputValue}
                  onInputValueChange={setRepositoryInputValue}
                  onValueChange={(repository) => {
                    if (repository !== null) props.onRepositoryChange(repository.remoteId)
                  }}
                  value={selectedRepository ?? null}
                >
                  <ComboboxInput
                    disabled={props.loadingRepositories || props.repositories.length === 0}
                    id="project-repository"
                    placeholder="Search repositories…"
                  />
                  <ComboboxContent>
                    <ComboboxEmpty>No repositories found.</ComboboxEmpty>
                    <ComboboxList>
                      {(repository: GitRepository) => (
                        <ComboboxItem key={repository.remoteId} value={repository}>
                          {repository.fullName}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
                <FieldDescription>
                  {props.loadingRepositories
                    ? 'Loading repositories…'
                    : props.repositories.length === 0
                      ? 'No repositories are available for this connection.'
                      : 'Slopify captures the default branch commit when each run starts.'}
                </FieldDescription>
              </Field>
              <Button
                disabled={
                  props.saving ||
                  props.loadingRepositories ||
                  props.selectedRepositoryId === undefined
                }
                type="submit"
              >
                {props.saving ? 'Adding project…' : 'Add project'}
              </Button>
            </form>
          ) : props.selectedProject === undefined ? null : (
            <>
              <section className="grid gap-2">
                <h3 className="text-[14px]/5 font-semibold">Repository</h3>
                <a
                  className="break-all rounded-md border border-border p-3 font-mono text-[12px]/5 text-muted-foreground hover:text-foreground"
                  href={props.selectedProject.webUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {props.selectedProject.fullName}
                </a>
                <p className="text-[12px]/4 text-muted-foreground">
                  Default branch:{' '}
                  <span className="font-mono">{props.selectedProject.defaultBranch}</span>
                </p>
              </section>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <div
                  aria-hidden={!props.confirmingDelete}
                  className={cn(
                    't-resize min-w-0 justify-self-end overflow-hidden',
                    props.confirmingDelete ? 'w-full' : 'w-0',
                  )}
                >
                  <Input
                    ref={confirmationInputRef}
                    aria-label="Repository name confirmation"
                    aria-invalid={
                      props.confirmationValue.length > 0 &&
                      props.confirmationValue !== props.selectedProject.fullName
                    }
                    autoComplete="off"
                    disabled={!props.confirmingDelete || props.deleting}
                    onChange={(event) => props.onConfirmationValueChange(event.target.value)}
                    placeholder="Enter owner/repository"
                    tabIndex={props.confirmingDelete ? 0 : -1}
                    value={props.confirmationValue}
                  />
                </div>
                <Button
                  className="col-start-2 ml-auto min-w-32"
                  disabled={
                    props.deleting ||
                    (props.confirmingDelete &&
                      props.confirmationValue !== props.selectedProject.fullName)
                  }
                  onClick={() => void props.onDelete()}
                  type="button"
                  variant="destructive"
                >
                  <Trash2Icon aria-hidden="true" />
                  {props.deleting
                    ? 'Deleting…'
                    : props.confirmingDelete
                      ? 'Confirm'
                      : 'Delete project'}
                </Button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  )
}

export function ProjectSettings({ client = defaultClient }: Readonly<{ client?: ProjectClient }>) {
  const [projects, setProjects] = useState<readonly Project[]>([])
  const [connections, setConnections] = useState<readonly GitConnection[]>([])
  const [repositories, setRepositories] = useState<readonly GitRepository[]>([])
  const [selectedProvider, setSelectedProvider] = useState<GitProvider>()
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string>()
  const [selection, setSelection] = useState<'add' | string>()
  const [closingProject, setClosingProject] = useState<Project>()
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingRepositories, setLoadingRepositories] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmationValue, setConfirmationValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string>()
  const panelRef = useRef<HTMLDivElement>(null)
  const openFrameRef = useRef<number | undefined>(undefined)

  const selectedProject =
    projects.find(({ projectId }) => projectId === selection) ??
    (closingProject?.projectId === selection ? closingProject : undefined)
  const visibleProjects = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    if (query === '') return projects
    return projects.filter(
      ({ name, fullName, provider }) =>
        name.toLocaleLowerCase().includes(query) ||
        fullName.toLocaleLowerCase().includes(query) ||
        providerLabel(provider).toLocaleLowerCase().includes(query),
    )
  }, [projects, searchQuery])

  useEffect(() => {
    let active = true
    void Promise.all([client.listProjects(), client.listGitConnections()])
      .then(([nextProjects, nextConnections]) => {
        if (!active) return
        setProjects(nextProjects)
        setConnections(nextConnections)
        setSelectedProvider(nextConnections[0]?.provider)
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
      if (openFrameRef.current !== undefined) window.cancelAnimationFrame(openFrameRef.current)
    }
  }, [client])

  useEffect(() => {
    if (selection !== 'add' || selectedProvider === undefined) return
    let active = true
    setLoadingRepositories(true)
    setRepositories([])
    setSelectedRepositoryId(undefined)
    void client
      .listGitRepositories(selectedProvider)
      .then((nextRepositories) => {
        if (!active) return
        setRepositories(nextRepositories)
        setSelectedRepositoryId(nextRepositories[0]?.remoteId)
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Repositories could not be loaded.')
      })
      .finally(() => {
        if (active) setLoadingRepositories(false)
      })
    return () => {
      active = false
    }
  }, [client, selectedProvider, selection])

  const closePanel = useCallback(() => {
    if (openFrameRef.current !== undefined) window.cancelAnimationFrame(openFrameRef.current)
    setIsPanelOpen(false)
    setConfirmingDelete(false)
    setConfirmationValue('')
    if (prefersReducedMotion()) {
      setSelection(undefined)
      setClosingProject(undefined)
    }
  }, [])

  const openPanel = useCallback((nextSelection: 'add' | string) => {
    if (openFrameRef.current !== undefined) window.cancelAnimationFrame(openFrameRef.current)
    setSelection(nextSelection)
    setClosingProject(undefined)
    setConfirmingDelete(false)
    setConfirmationValue('')
    setError(undefined)
    setIsPanelOpen(false)
    if (prefersReducedMotion()) {
      setIsPanelOpen(true)
      return
    }
    openFrameRef.current = window.requestAnimationFrame(() => {
      openFrameRef.current = window.requestAnimationFrame(() => setIsPanelOpen(true))
    })
  }, [])

  useEffect(() => {
    if (!isPanelOpen) return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        panelRef.current?.contains(target as Node) ||
        (target instanceof Element &&
          target.closest('[data-slot="select-content"], [data-slot="combobox-content"]') !== null)
      ) {
        return
      }
      closePanel()
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [closePanel, isPanelOpen])

  const addProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (selectedProvider === undefined || selectedRepositoryId === undefined) return
    setSaving(true)
    setError(undefined)
    try {
      const project = await client.addProject({
        provider: selectedProvider,
        remoteId: selectedRepositoryId,
      })
      setProjects((current) => [...current, project])
      closePanel()
      toast.add({
        title: 'Project added',
        description: `${project.fullName} is now available in Slopify.`,
        type: 'success',
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Project could not be added.')
    } finally {
      setSaving(false)
    }
  }

  const deleteProject = async () => {
    if (selectedProject === undefined) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    if (confirmationValue !== selectedProject.fullName) return
    setDeleting(true)
    setError(undefined)
    try {
      const receipt = await client.deleteProject(selectedProject.projectId)
      setClosingProject(selectedProject)
      setProjects((current) =>
        current.filter(({ projectId }) => projectId !== selectedProject.projectId),
      )
      closePanel()
      showUndoDeletionToast({
        receipt,
        deletedTitle: 'Project deleted',
        deletedDescription: `${selectedProject.fullName} was removed from Slopify.`,
        restoredTitle: 'Project restored',
        restoredDescription: `${selectedProject.fullName} is available in Slopify again.`,
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

  return (
    <section aria-label="Projects" className="w-full px-6 pt-6 pb-10 sm:pb-12">
      <CatalogToolbar
        addDisabled={connections.length === 0}
        onAdd={() => openPanel('add')}
        onQueryChange={setSearchQuery}
        plural="projects"
        query={searchQuery}
        singular="project"
      />

      {error === undefined ? null : (
        <Alert className="mb-3" variant="destructive">
          <AlertTitle>Project unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <CatalogCardSkeleton label="projects" />
      ) : (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]"
          data-testid="project-grid"
        >
          {visibleProjects.map((project) => (
            <ProjectTile
              key={project.projectId}
              onSelect={() => openPanel(project.projectId)}
              project={project}
            />
          ))}
        </div>
      )}

      {!loading && projects.length === 0 && error === undefined ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
          <p className="text-[14px]/5 font-semibold">No projects yet</p>
          <p className="mt-1 text-[13px]/5 text-muted-foreground">
            {connections.length === 0
              ? 'Connect GitHub or GitLab in Settings before adding a project.'
              : 'Add a repository from one of your connected Git providers.'}
          </p>
          {connections.length === 0 ? (
            <Link className={cn(buttonVariants({ variant: 'outline' }), 'mt-4')} href="/settings">
              Open Settings
            </Link>
          ) : null}
        </div>
      ) : !loading && visibleProjects.length === 0 && error === undefined ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
          <p className="text-[14px]/5 font-semibold">No matching projects</p>
          <p className="mt-1 text-[13px]/5 text-muted-foreground">
            Try a different name, provider, or repository path.
          </p>
        </div>
      ) : null}

      {selection === undefined ? null : (
        <ProjectPanel
          connections={connections}
          confirmingDelete={confirmingDelete}
          confirmationValue={confirmationValue}
          deleting={deleting}
          isOpen={isPanelOpen}
          loadingRepositories={loadingRepositories}
          onAdd={addProject}
          onClose={closePanel}
          onConfirmationValueChange={setConfirmationValue}
          onDelete={deleteProject}
          onExited={() => {
            setClosingProject(undefined)
            setSelection(undefined)
          }}
          onProviderChange={(provider) => {
            setSelectedProvider(provider)
            setSelectedRepositoryId(undefined)
          }}
          onRepositoryChange={setSelectedRepositoryId}
          panelRef={panelRef}
          repositories={repositories}
          saving={saving}
          selectedProject={selectedProject}
          selectedProvider={selectedProvider}
          selectedRepositoryId={selectedRepositoryId}
          selection={selection}
        />
      )}
    </section>
  )
}
