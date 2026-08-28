'use client'

import type { GitConnection, GitProvider, GitRepository, Repository } from '@slopify/contracts'
import { FolderGit2Icon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type RefObject,
} from 'react'

import { useDeleteConfirmationDismissal } from '@/components/use-delete-confirmation-dismissal'
import { CatalogCardSkeleton } from '@/components/settings/catalog-card-skeleton'
import { CatalogCardTags } from '@/components/settings/catalog-card-tags'
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
import { toast } from '@/lib/toast'
import {
  connectResourceEventStream,
  type ConnectResourceEventStream,
} from '@/lib/resource-event-stream'
import { cn } from '@/lib/utils'

type RepositoryClient = Pick<
  ApiClient,
  | 'addRepository'
  | 'deleteRepository'
  | 'listGitConnections'
  | 'listGitRepositories'
  | 'listRepositories'
>

const defaultClient = createApiClient()

const providerLabel = (provider: GitProvider): string =>
  provider === 'GITHUB' ? 'GitHub' : 'GitLab'

const statusLabel = (availability: Repository['availability']): string =>
  availability === 'AVAILABLE'
    ? 'Available'
    : availability === 'CONNECTION_MISSING'
      ? 'Connection missing'
      : 'Repository unavailable'

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function RepositoryIcon({ provider }: Readonly<{ provider?: GitProvider }>) {
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

function RepositoryStatus({ repository }: Readonly<{ repository: Repository }>) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'shrink-0 font-normal',
        repository.availability === 'AVAILABLE' && 'bg-status-success/10 text-status-success',
        repository.availability === 'CONNECTION_MISSING' &&
          'bg-status-warning/10 text-status-warning',
        repository.availability === 'REPOSITORY_UNAVAILABLE' &&
          'bg-status-danger/10 text-status-danger',
      )}
    >
      {statusLabel(repository.availability)}
    </Badge>
  )
}

function RepositoryTile({
  onSelect,
  repository,
}: Readonly<{ onSelect: () => void; repository: Repository }>) {
  return (
    <Button
      aria-label={`${repository.name}, ${statusLabel(repository.availability)}`}
      className={cn(
        'h-auto min-h-[140px] w-full flex-col items-stretch justify-start gap-0 overflow-hidden rounded-lg border border-border bg-card p-0 text-left whitespace-normal shadow-[var(--shadow-raised)] transition-[background-color,border-color,box-shadow,opacity] duration-150 hover:border-input hover:bg-accent/45 hover:shadow-[var(--shadow-raised-hover)] focus-visible:border-input',
        repository.availability !== 'AVAILABLE' && 'bg-muted/20 opacity-70',
      )}
      onClick={onSelect}
      type="button"
      variant="ghost"
    >
      <span className="flex min-h-0 flex-1 items-start gap-3.5 p-4">
        <RepositoryIcon provider={repository.provider} />
        <span className="flex min-w-0 flex-1 self-stretch flex-col gap-1">
          <span className="truncate text-[14px]/5 font-semibold tracking-[-0.01em] text-foreground">
            {repository.name}
          </span>
          <span className="text-[12px]/4 font-medium text-muted-foreground">
            {providerLabel(repository.provider)} repository
          </span>
          <span className="mt-1 truncate font-mono text-[12px]/5 font-normal text-muted-foreground">
            {repository.fullName}
          </span>
          <CatalogCardTags>
            <RepositoryStatus repository={repository} />
          </CatalogCardTags>
        </span>
      </span>
    </Button>
  )
}

function AddRepositoryTile({ onSelect }: Readonly<{ onSelect: () => void }>) {
  return (
    <Button
      aria-label="Add repository"
      className="h-auto min-h-[140px] w-full rounded-lg border-dashed border-border bg-card text-muted-foreground hover:border-input hover:bg-accent/45 hover:text-foreground focus-visible:border-input"
      onClick={onSelect}
      type="button"
      variant="ghost"
    >
      <PlusIcon aria-hidden="true" />
    </Button>
  )
}

interface RepositoryPanelProps {
  readonly connections: readonly GitConnection[]
  readonly confirmingDelete: boolean
  readonly confirmationValue: string
  readonly deleting: boolean
  readonly isOpen: boolean
  readonly loadingRepositories: boolean
  readonly onAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>
  readonly onClose: () => void
  readonly onDismissDelete: () => void
  readonly onConfirmationValueChange: (value: string) => void
  readonly onDelete: () => Promise<void>
  readonly onExited: () => void
  readonly onProviderChange: (provider: GitProvider) => void
  readonly onRepositoryChange: (remoteId: string) => void
  readonly panelRef: RefObject<HTMLDivElement | null>
  readonly repositories: readonly GitRepository[]
  readonly saving: boolean
  readonly selectedRepository: Repository | undefined
  readonly selectedProvider: GitProvider | undefined
  readonly selectedRepositoryId: string | undefined
  readonly selection: 'add' | string | undefined
}

function RepositoryPanel(props: RepositoryPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const confirmationInputRef = useRef<HTMLInputElement>(null)
  const deleteActionRef = useRef<HTMLButtonElement>(null)
  const panelTitle = props.selection === 'add' ? 'Add repository' : props.selectedRepository?.name
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

  useDeleteConfirmationDismissal({
    actionRef: deleteActionRef,
    active: props.confirmingDelete,
    confirmationRef: confirmationInputRef,
    disabled: props.deleting,
    onDismiss: props.onDismissDelete,
  })

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
      data-testid="repository-panel-shell"
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
        aria-labelledby="repository-panel-title"
        aria-modal="false"
        className="t-panel-slide relative m-0 flex h-full max-h-none w-full max-w-none flex-col overflow-hidden rounded-xl border border-border bg-card p-0 text-card-foreground shadow-[var(--shadow-overlay)]"
        data-layout="floating"
        data-open={props.isOpen}
      >
        <header className="relative shrink-0 border-b border-border p-6 pr-14">
          <div className="flex items-center gap-3">
            <RepositoryIcon />
            <div className="min-w-0">
              <h2
                id="repository-panel-title"
                className="text-[18px]/6 font-semibold tracking-[-0.01em]"
              >
                {panelTitle}
              </h2>
              <p className="text-[12px]/4 text-muted-foreground">
                {props.selectedRepository === undefined
                  ? 'GitHub or GitLab repository'
                  : `${providerLabel(props.selectedRepository.provider)} · ${props.selectedRepository.fullName}`}
              </p>
            </div>
            {props.selectedRepository === undefined ? null : (
              <div className="ml-auto">
                <RepositoryStatus repository={props.selectedRepository} />
              </div>
            )}
          </div>
          <Button
            aria-label="Close repository details"
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
                <FieldLabel htmlFor="repository-provider">Provider</FieldLabel>
                <Select
                  onValueChange={(value) => {
                    if (value !== null) props.onProviderChange(value as GitProvider)
                  }}
                  value={props.selectedProvider ?? null}
                >
                  <SelectTrigger className="w-full" id="repository-provider">
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
                <FieldLabel htmlFor="repository-repository">Repository</FieldLabel>
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
                    id="repository-repository"
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
                {props.saving ? 'Adding repository…' : 'Add repository'}
              </Button>
            </form>
          ) : props.selectedRepository === undefined ? null : (
            <>
              <section className="grid gap-2">
                <h3 className="text-[14px]/5 font-semibold">Repository</h3>
                <a
                  className="break-all rounded-md border border-border p-3 font-mono text-[12px]/5 text-muted-foreground hover:text-foreground"
                  href={props.selectedRepository.webUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {props.selectedRepository.fullName}
                </a>
                <p className="text-[12px]/4 text-muted-foreground">
                  Default branch:{' '}
                  <span className="font-mono">{props.selectedRepository.defaultBranch}</span>
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
                      props.confirmationValue !== props.selectedRepository.fullName
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
                  ref={deleteActionRef}
                  className="col-start-2 ml-auto min-w-32"
                  disabled={
                    props.deleting ||
                    (props.confirmingDelete &&
                      props.confirmationValue !== props.selectedRepository.fullName)
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
                      : 'Delete repository'}
                </Button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  )
}

export function RepositorySettings({
  client = defaultClient,
  connectResourceEvents = connectResourceEventStream,
}: Readonly<{
  client?: RepositoryClient
  connectResourceEvents?: ConnectResourceEventStream
}>) {
  const [repositories, setRepositories] = useState<readonly Repository[]>([])
  const [connections, setConnections] = useState<readonly GitConnection[]>([])
  const [remoteRepositories, setRemoteRepositories] = useState<readonly GitRepository[]>([])
  const [selectedProvider, setSelectedProvider] = useState<GitProvider>()
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string>()
  const [selection, setSelection] = useState<'add' | string>()
  const [closingRepository, setClosingRepository] = useState<Repository>()
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingRepositories, setLoadingRepositories] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmationValue, setConfirmationValue] = useState('')
  const [error, setError] = useState<string>()
  const [refreshVersion, refresh] = useReducer((current: number) => current + 1, 0)
  const panelRef = useRef<HTMLDivElement>(null)
  const openFrameRef = useRef<number | undefined>(undefined)
  const catalogLoadSequence = useRef(0)
  const cleanRef = useRef(true)

  cleanRef.current = selection === undefined && !saving && !deleting

  const selectedRepository =
    repositories.find(({ repositoryId }) => repositoryId === selection) ??
    (closingRepository?.repositoryId === selection ? closingRepository : undefined)
  useEffect(() => {
    let active = true
    const sequence = ++catalogLoadSequence.current
    void Promise.all([client.listRepositories(), client.listGitConnections()])
      .then(([nextRepositories, nextConnections]) => {
        if (!active || sequence !== catalogLoadSequence.current) return
        setRepositories(nextRepositories)
        setConnections(nextConnections)
        setSelectedProvider((current) =>
          current !== undefined && nextConnections.some(({ provider }) => provider === current)
            ? current
            : nextConnections[0]?.provider,
        )
        setError(undefined)
      })
      .catch((cause: unknown) => {
        if (active && sequence === catalogLoadSequence.current)
          setError(cause instanceof Error ? cause.message : 'Repositories could not be loaded.')
      })
      .finally(() => {
        if (active && sequence === catalogLoadSequence.current) setLoading(false)
      })
    return () => {
      active = false
      if (openFrameRef.current !== undefined) window.cancelAnimationFrame(openFrameRef.current)
    }
  }, [client, refreshVersion])

  useEffect(
    () =>
      connectResourceEvents({
        onDisconnect: () => undefined,
        onEvent: (event) => {
          if (
            cleanRef.current &&
            (event.resource.type === 'REPOSITORIES' || event.resource.type === 'SETTINGS')
          ) {
            refresh()
          }
        },
        onInvalidEvent: () => undefined,
        onOpen: () => undefined,
        onReconcile: () => {
          if (cleanRef.current) refresh()
        },
      }),
    [connectResourceEvents],
  )

  useEffect(() => {
    if (selection !== 'add' || selectedProvider === undefined) return
    let active = true
    setLoadingRepositories(true)
    setRemoteRepositories([])
    setSelectedRepositoryId(undefined)
    void client
      .listGitRepositories(selectedProvider)
      .then((nextRepositories) => {
        if (!active) return
        setRemoteRepositories(nextRepositories)
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
      setClosingRepository(undefined)
    }
  }, [])

  const openPanel = useCallback((nextSelection: 'add' | string) => {
    if (openFrameRef.current !== undefined) window.cancelAnimationFrame(openFrameRef.current)
    setSelection(nextSelection)
    setClosingRepository(undefined)
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

  const dismissDeleteConfirmation = useCallback(() => {
    setConfirmingDelete(false)
    setConfirmationValue('')
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

  const addRepository = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (selectedProvider === undefined || selectedRepositoryId === undefined) return
    setSaving(true)
    setError(undefined)
    try {
      const repository = await client.addRepository({
        provider: selectedProvider,
        remoteId: selectedRepositoryId,
      })
      setRepositories((current) => [...current, repository])
      closePanel()
      toast.add({
        title: 'Repository added',
        description: `${repository.fullName} is now available in Slopify.`,
        type: 'success',
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Repository could not be added.')
    } finally {
      setSaving(false)
    }
  }

  const deleteRepository = async () => {
    if (selectedRepository === undefined) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    if (confirmationValue !== selectedRepository.fullName) return
    setDeleting(true)
    setError(undefined)
    try {
      await client.deleteRepository(selectedRepository.repositoryId)
      setClosingRepository(selectedRepository)
      setRepositories((current) =>
        current.filter(({ repositoryId }) => repositoryId !== selectedRepository.repositoryId),
      )
      closePanel()
      toast.add({
        title: 'Repository deleted',
        description: `${selectedRepository.fullName} was removed from Slopify.`,
        type: 'success',
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Repository could not be deleted.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section aria-label="Repositories" className="w-full px-6 pt-6 pb-10 sm:pb-12">
      {error === undefined ? null : (
        <Alert className="mb-3" variant="destructive">
          <AlertTitle>Repository unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <CatalogCardSkeleton label="repositories" />
      ) : repositories.length > 0 ? (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]"
          data-testid="repository-grid"
        >
          {repositories.map((repository) => (
            <RepositoryTile
              key={repository.repositoryId}
              onSelect={() => openPanel(repository.repositoryId)}
              repository={repository}
            />
          ))}
          {connections.length > 0 ? <AddRepositoryTile onSelect={() => openPanel('add')} /> : null}
        </div>
      ) : null}

      {!loading && repositories.length === 0 && error === undefined ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
          <p className="text-[14px]/5 font-semibold">No repositories yet</p>
          <p className="mt-1 text-[13px]/5 text-muted-foreground">
            {connections.length === 0
              ? 'Connect GitHub or GitLab in Settings before adding a repository.'
              : 'Add a repository from one of your connected Git providers.'}
          </p>
          {connections.length === 0 ? (
            <Link className={cn(buttonVariants({ variant: 'outline' }), 'mt-4')} href="/settings">
              Open Settings
            </Link>
          ) : (
            <Button
              className="mt-4"
              onClick={() => openPanel('add')}
              type="button"
              variant="outline"
            >
              Add repository
            </Button>
          )}
        </div>
      ) : null}

      {selection === undefined ? null : (
        <RepositoryPanel
          connections={connections}
          confirmingDelete={confirmingDelete}
          confirmationValue={confirmationValue}
          deleting={deleting}
          isOpen={isPanelOpen}
          loadingRepositories={loadingRepositories}
          onAdd={addRepository}
          onClose={closePanel}
          onDismissDelete={dismissDeleteConfirmation}
          onConfirmationValueChange={setConfirmationValue}
          onDelete={deleteRepository}
          onExited={() => {
            setClosingRepository(undefined)
            setSelection(undefined)
          }}
          onProviderChange={(provider) => {
            setSelectedProvider(provider)
            setSelectedRepositoryId(undefined)
          }}
          onRepositoryChange={setSelectedRepositoryId}
          panelRef={panelRef}
          repositories={remoteRepositories}
          saving={saving}
          selectedRepository={selectedRepository}
          selectedProvider={selectedProvider}
          selectedRepositoryId={selectedRepositoryId}
          selection={selection}
        />
      )}
    </section>
  )
}
