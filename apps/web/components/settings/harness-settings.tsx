'use client'

import type { HarnessDescriptor } from '@slopify/contracts'
import { ExternalLinkIcon, XIcon } from 'lucide-react'
import Image from 'next/image'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

import { CatalogCardSkeleton } from '@/components/settings/catalog-card-skeleton'
import { CatalogCardTags } from '@/components/settings/catalog-card-tags'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { createApiClient, type ApiClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'

type HarnessSettingsClient = Pick<ApiClient, 'listHarnesses'>

export interface HarnessSettingsProps {
  readonly client?: HarnessSettingsClient
}

const defaultClient = createApiClient()
const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
const statusLabel = (harness: HarnessDescriptor): string =>
  harness.availability === 'AVAILABLE' ? 'Available' : 'Unavailable'

function HarnessIcon({ harness }: Readonly<{ harness: HarnessDescriptor }>) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
      {harness.harnessId === 'codex' ? (
        <Image alt="ChatGPT" height={20} src="/chatgpt-logo.svg" width={20} />
      ) : (
        <Image alt="Pi" height={20} src="/pi-badge.svg" width={20} />
      )}
    </span>
  )
}

function HarnessStatus({ harness }: Readonly<{ harness: HarnessDescriptor }>) {
  return (
    <Badge
      className={cn(
        'shrink-0 font-normal',
        harness.availability === 'AVAILABLE'
          ? 'bg-status-success/10 text-status-success'
          : 'bg-status-warning/10 text-status-warning',
      )}
      variant="secondary"
    >
      {statusLabel(harness)}
    </Badge>
  )
}

function HarnessTile({
  harness,
  onSelect,
}: Readonly<{ harness: HarnessDescriptor; onSelect: () => void }>) {
  return (
    <Button
      aria-label={`${harness.name}, ${statusLabel(harness)}`}
      className={cn(
        'h-auto min-h-[140px] w-full flex-col items-stretch justify-start gap-0 overflow-hidden rounded-lg border border-border bg-card p-0 text-left whitespace-normal shadow-[var(--shadow-raised)] transition-[background-color,border-color,box-shadow,opacity] duration-150 hover:border-input hover:bg-accent/45 hover:shadow-[var(--shadow-raised-hover)] focus-visible:border-input',
        harness.availability !== 'AVAILABLE' && 'bg-muted/20 opacity-70',
      )}
      onClick={onSelect}
      type="button"
      variant="ghost"
    >
      <span className="flex min-h-0 flex-1 items-start gap-3.5 p-4">
        <HarnessIcon harness={harness} />
        <span className="flex min-w-0 flex-1 self-stretch flex-col gap-1">
          <span className="truncate text-[14px]/5 font-semibold tracking-[-0.01em] text-foreground">
            {harness.name}
          </span>
          <span className="text-[12px]/4 font-medium text-muted-foreground">Agent harness</span>
          <span className="mt-1 line-clamp-2 text-[12px]/5 font-normal text-muted-foreground">
            {harness.description}
          </span>
          <CatalogCardTags>
            <HarnessStatus harness={harness} />
          </CatalogCardTags>
        </span>
      </span>
    </Button>
  )
}

interface HarnessPanelProps {
  readonly harness: HarnessDescriptor
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly onExited: () => void
  readonly panelRef: RefObject<HTMLDivElement | null>
}

function HarnessPanel({ harness, isOpen, onClose, onExited, panelRef }: HarnessPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const modelLabel = `${harness.models.length} ${harness.models.length === 1 ? 'model' : 'models'}`

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
      className="floating-panel-shell fixed top-[4.25rem] right-3 bottom-3 left-3 z-30 w-auto sm:left-auto sm:w-[min(34rem,calc(100%-1.5rem))]"
      data-open={isOpen}
      data-testid="harness-panel-shell"
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
        aria-labelledby="harness-panel-title"
        aria-modal="false"
        className="t-panel-slide relative m-0 flex h-full max-h-none w-full max-w-none flex-col overflow-hidden rounded-xl border border-border bg-card p-0 text-card-foreground shadow-[var(--shadow-overlay)]"
        data-layout="floating"
        data-open={isOpen}
      >
        <header className="relative shrink-0 border-b border-border p-6 pr-14">
          <div className="flex items-center gap-3">
            <HarnessIcon harness={harness} />
            <div className="min-w-0">
              <h2
                id="harness-panel-title"
                className="text-[18px]/6 font-semibold tracking-[-0.01em]"
              >
                {harness.name}
              </h2>
              <p className="text-[12px]/4 text-muted-foreground">Agent harness</p>
            </div>
            <div className="ml-auto">
              <HarnessStatus harness={harness} />
            </div>
          </div>
          <Button
            aria-label="Close harness details"
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
          <section className="grid gap-2">
            <h3 className="text-[14px]/5 font-semibold">About</h3>
            <p className="text-[13px]/5 text-muted-foreground">{harness.description}</p>
          </section>

          {harness.availability === 'AVAILABLE' ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs/4 text-muted-foreground">Version</dt>
                <dd className="mt-1 text-sm/5 font-medium">Version {harness.version}</dd>
              </div>
              <div>
                <dt className="text-xs/4 text-muted-foreground">Discovered models</dt>
                <dd className="mt-1 text-sm/5 font-medium">{modelLabel}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs/4 text-muted-foreground">Executable</dt>
                <dd className="mt-1 break-all rounded-md border border-border p-3 font-mono text-[12px]/5 text-muted-foreground">
                  {harness.executablePath}
                </dd>
              </div>
            </dl>
          ) : (
            <section className="grid gap-3">
              <div>
                <h3 className="text-[14px]/5 font-semibold">Setup required</h3>
                <p className="mt-1 text-[13px]/5 text-muted-foreground">
                  {harness.unavailableReason}
                </p>
              </div>
              <a
                className="inline-flex min-h-9 w-fit items-center gap-2 rounded-md px-3 text-sm/5 font-medium underline underline-offset-4 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
                href={harness.installHref}
                rel="noreferrer"
                target="_blank"
              >
                {harness.installLabel}
                <ExternalLinkIcon aria-hidden="true" className="size-4" />
              </a>
            </section>
          )}
        </div>
      </dialog>
    </div>
  )
}

export function HarnessSettings({ client = defaultClient }: HarnessSettingsProps) {
  const [harnesses, setHarnesses] = useState<readonly HarnessDescriptor[]>([])
  const [selectedHarnessId, setSelectedHarnessId] = useState<string>()
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const panelRef = useRef<HTMLDivElement>(null)
  const openFrameRef = useRef<number | undefined>(undefined)
  const selectedHarness = harnesses.find(({ harnessId }) => harnessId === selectedHarnessId)

  useEffect(() => {
    let active = true
    void client
      .listHarnesses()
      .then((nextHarnesses) => {
        if (active) setHarnesses(nextHarnesses)
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Harnesses could not be discovered.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      if (openFrameRef.current !== undefined) window.cancelAnimationFrame(openFrameRef.current)
    }
  }, [client])

  const closePanel = useCallback(() => {
    if (openFrameRef.current !== undefined) window.cancelAnimationFrame(openFrameRef.current)
    setIsPanelOpen(false)
    if (prefersReducedMotion()) setSelectedHarnessId(undefined)
  }, [])

  const openPanel = useCallback((harnessId: string) => {
    if (openFrameRef.current !== undefined) window.cancelAnimationFrame(openFrameRef.current)
    setSelectedHarnessId(harnessId)
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
      if (!panelRef.current?.contains(event.target as Node)) closePanel()
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [closePanel, isPanelOpen])

  return (
    <section aria-label="Harnesses" className="w-full px-6 pt-6 pb-10 sm:pb-12">
      {error === undefined ? null : (
        <Alert className="mb-3" variant="destructive">
          <AlertTitle>Harnesses unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <CatalogCardSkeleton label="harnesses" />
      ) : error !== undefined ? null : harnesses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm/5 font-semibold">No supported harnesses</p>
          <p className="mt-1 text-sm/5 text-muted-foreground">
            Install a supported harness on this machine before creating an agent.
          </p>
        </div>
      ) : (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]"
          data-testid="harness-grid"
        >
          {harnesses.map((harness) => (
            <HarnessTile
              key={harness.harnessId}
              harness={harness}
              onSelect={() => openPanel(harness.harnessId)}
            />
          ))}
        </div>
      )}

      {selectedHarness === undefined ? null : (
        <HarnessPanel
          harness={selectedHarness}
          isOpen={isPanelOpen}
          onClose={closePanel}
          onExited={() => setSelectedHarnessId(undefined)}
          panelRef={panelRef}
        />
      )}
    </section>
  )
}
