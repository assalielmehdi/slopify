'use client'

import {
  ExternalLinkIcon,
  Grid2X2Icon,
  ListIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import type { ConnectionCatalogEntry } from '@loop/contracts'
import type { ComponentType, CSSProperties, SVGProps } from 'react'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Separator } from '@/components/ui/separator'
import {
  createApiClient,
  type ApiClient,
  type ChatGptOAuthTransaction,
  type ConnectionRecord,
} from '@/lib/api-client'
import { cn } from '@/lib/utils'

const defaultClient = createApiClient()
type ConnectionClient = Required<
  Pick<
    ApiClient,
    | 'listConnections'
    | 'connect'
    | 'revalidateConnection'
    | 'replaceConnectionCredential'
    | 'deleteConnection'
    | 'startChatGptOAuth'
    | 'getChatGptOAuth'
  >
>

type ConnectionType = ConnectionRecord['type']
type CatalogKind = 'all' | 'providers' | 'connectors'
type CatalogView = 'grid' | 'list'

const catalogViewOptions: readonly { value: CatalogView; label: string; icon: LucideIcon }[] = [
  { value: 'grid', label: 'Grid view', icon: Grid2X2Icon },
  { value: 'list', label: 'List view', icon: ListIcon },
]

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function OpenRouterMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 401.4 293.7" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fill="currentColor"
        d="M303.9475 17.1993c42.7973 0 77.4893 34.6932 77.4893 77.4893 0 42.796-34.692 77.4893-77.4893 77.4893l76.8617 76.8625c9.7636 9.7631 2.849 26.4566-10.957 26.4566H148.9688c-71.3268 0-129.1488-57.822-129.1488-129.1488S77.642 17.1993 148.9688 17.1993h154.9787ZM148.9688 68.8588c-42.796 0-77.4893 34.6933-77.4893 77.4894 0 42.796 34.6933 77.4893 77.4893 77.4893 42.7961 0 77.4894-34.6933 77.4894-77.4893 0-42.7961-34.6933-77.4894-77.4894-77.4894Z"
      />
    </svg>
  )
}

function ChatGptMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fill="currentColor"
        d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729Zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944Zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464ZM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872Zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667Zm2.0107-3.0231-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66ZM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813Zm1.0976-2.3654 2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
      />
    </svg>
  )
}

function GitLabMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="105 105 170 170" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fill="#E24329"
        d="M265.26416 174.37243l-.2134-.55822-21.19899-55.30908c-.4236-1.08359-1.18542-1.99642-2.17699-2.62689-.98837-.63373-2.14749-.93253-3.32305-.87014-1.1689.06239-2.29195.48925-3.20809 1.21821-.90957.73554-1.56629 1.73047-1.87493 2.85346l-14.31327 43.80662h-57.90965l-14.31327-43.80662c-.30864-1.12299-.96536-2.11791-1.87493-2.85346-.91614-.72895-2.03911-1.15582-3.20809-1.21821-1.17548-.06239-2.33468.23641-3.32297.87014-.99166.63047-1.75348 1.5433-2.17707 2.62689l-21.19891 55.31237-.21348.55493c-6.28158 16.38521-.92929 34.90803 13.05891 45.48782.02621.01641.04922.03611.07552.05582l.18719.14119 32.29094 24.17392 15.97151 12.09024 9.71951 7.34871c2.34117 1.77316 5.57877 1.77316 7.92002 0l9.71943-7.34871 15.96822-12.09024 32.48142-24.31511c.02958-.02299.05588-.04269.08538-.06568 13.97834-10.57977 19.32735-29.09604 13.04905-45.47796Z"
      />
      <path
        fill="#FC6D26"
        d="M265.26416 174.37243l-.2134-.55822c-10.5174 2.16062-20.20405 6.6099-28.49844 12.81593-.1346.0985-25.20497 19.05805-46.55171 35.19699 15.84998 11.98517 29.6477 22.40405 29.6477 22.40405l32.48142-24.31511c.02958-.02299.05588-.04269.08538-.06568 13.97834-10.57977 19.32735-29.09604 13.04905-45.47796Z"
      />
      <path
        fill="#FCA326"
        d="m160.34962 244.23117 15.97151 12.09024 9.71951 7.34871c2.34117 1.77316 5.57877 1.77316 7.92002 0l9.71943-7.34871 15.96822-12.09024s-13.79772-10.41888-29.6477-22.40405c-15.85327 11.98517-29.65099 22.40405-29.65099 22.40405Z"
      />
      <path
        fill="#FC6D26"
        d="M143.44561 186.63014c-8.29111-6.20274-17.97446-10.65531-28.49507-12.81264l-.21348.55493c-6.28158 16.38521-.92929 34.90803 13.05891 45.48782.02621.01641.04922.03611.07552.05582l.18719.14119 32.29094 24.17392s13.79772-10.41888 29.65099-22.40405c-21.34673-16.13894-46.42031-35.09848-46.55499-35.19699Z"
      />
    </svg>
  )
}

function ClickUpMark(props: SVGProps<SVGSVGElement>) {
  const gradientId = useId()
  const lowerGradientId = `${gradientId}-lower`
  const upperGradientId = `${gradientId}-upper`

  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.43828 50.2095c-.62652-.7639-.48946-1.8883.2809-2.5068l7.29772-5.8594c.6366-.5111 1.5672-.3957 2.0863.2344 4.9568 6.0179 10.2168 8.8038 16.0388 8.8038 5.7818 0 10.8983-2.7465 15.6381-8.6976.5087-.6387 1.4371-.7708 2.0828-.271l7.3975 5.7248c.7811.6045.9385 1.726.3251 2.5002-7.008 8.846-15.5884 13.5067-25.4435 13.5067-9.8264 0-18.4834-4.6316-25.70372-13.4351Z"
        fill={`url(#${lowerGradientId})`}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M32.4953 17.1804c-.2751-.2436-.6886-.2437-.9639-.0003L15.663 31.2116c-.6066.5364-1.5345.4741-2.064-.1385l-6.18914-7.1609c-.52212-.604-.45967-1.5161.13993-2.0434L31.0527 1.20062c.5494-.483117 1.3721-.483009 1.9214.00026l23.5081 20.68382c.6.5278.6617 1.4409.1383 2.0447l-6.2041 7.1572c-.5302.6116-1.4575.6728-2.0634.1363L32.4953 17.1804Z"
        fill={`url(#${upperGradientId})`}
      />
      <defs>
        <linearGradient
          id={lowerGradientId}
          x1="5.3335"
          y1="32.1624"
          x2="58.6653"
          y2="32.1624"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.225962" stopColor="#6647F0" />
          <stop offset="0.793269" stopColor="#0091FF" />
        </linearGradient>
        <linearGradient
          id={upperGradientId}
          x1="5.3335"
          y1="31.6447"
          x2="58.6653"
          y2="31.6447"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FF02F0" />
          <stop offset="0.778846" stopColor="#F76808" />
        </linearGradient>
      </defs>
    </svg>
  )
}

const brandMarks: Readonly<
  Record<
    ConnectionCatalogEntry['icon'],
    Readonly<{
      icon: ComponentType<SVGProps<SVGSVGElement>>
      className: string
    }>
  >
> = {
  gitlab: { icon: GitLabMark, className: '' },
  clickup: { icon: ClickUpMark, className: '' },
  openrouter: { icon: OpenRouterMark, className: 'text-[#7624F4]' },
  chatgpt: { icon: ChatGptMark, className: 'text-foreground' },
}

const visibleCatalog = (
  entries: readonly ConnectionCatalogEntry[],
  kind: CatalogKind,
): readonly ConnectionCatalogEntry[] =>
  entries.filter((entry) =>
    kind === 'all'
      ? true
      : kind === 'providers'
        ? entry.category === 'inference'
        : entry.category === 'connector',
  )

const catalogSectionClassName = 'w-full px-6 pt-6 pb-10 sm:pb-12'

const connectionFor = (
  connections: readonly ConnectionRecord[],
  type: ConnectionType,
): ConnectionRecord | undefined =>
  connections
    .filter((connection) => connection.type === type)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]

const statusLabel = (connection: ConnectionRecord | undefined): string =>
  connection === undefined
    ? 'Not connected'
    : connection.status === 'CONNECTED'
      ? 'Connected'
      : 'Needs attention'

function ConnectionStatus({ connection }: Readonly<{ connection: ConnectionRecord | undefined }>) {
  const label = statusLabel(connection)
  return (
    <Badge
      variant={connection?.status === 'INVALID' ? 'destructive' : 'secondary'}
      className={cn(
        'shrink-0 font-normal',
        connection === undefined && 'text-muted-foreground',
        connection?.status === 'CONNECTED' && 'bg-status-success/10 text-status-success',
      )}
    >
      {label}
    </Badge>
  )
}

function ConnectionIcon({ definition }: Readonly<{ definition: ConnectionCatalogEntry }>) {
  const mark = brandMarks[definition.icon]
  const Icon = mark.icon
  const isChatGpt = definition.icon === 'chatgpt'
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
      <Icon
        data-testid={`${definition.icon}-mark`}
        aria-hidden="true"
        className={cn(isChatGpt ? 'size-[19px]' : 'size-5', mark.className)}
      />
    </span>
  )
}

function ConnectionTile({
  connection,
  definition,
  onSelect,
  view,
}: Readonly<{
  connection: ConnectionRecord | undefined
  definition: ConnectionCatalogEntry
  onSelect: () => void
  view: CatalogView
}>) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={`${definition.name}, ${statusLabel(connection)}`}
      className={cn(
        'w-full items-stretch justify-start gap-0 overflow-hidden rounded-lg border border-border bg-card p-0 text-left whitespace-normal shadow-[var(--shadow-raised)] transition-[background-color,border-color,box-shadow] duration-150 hover:border-input hover:bg-accent/45 hover:shadow-[var(--shadow-raised-hover)] focus-visible:border-input',
        view === 'grid' ? 'h-[140px] flex-col' : 'min-h-24 flex-col',
      )}
      onClick={onSelect}
    >
      <span className="flex min-h-0 flex-1 items-start gap-3.5 p-4">
        <ConnectionIcon definition={definition} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-start justify-between gap-2">
            <span className="text-[14px]/5 font-semibold tracking-[-0.01em] text-foreground">
              {definition.name}
            </span>
            <ConnectionStatus connection={connection} />
          </span>
          <span className="text-[12px]/4 font-medium text-muted-foreground">
            {definition.eyebrow}
          </span>
          <span
            className={cn(
              'mt-1 text-[13px]/5 font-normal text-muted-foreground',
              view === 'grid' ? 'line-clamp-3' : 'line-clamp-1',
            )}
          >
            {definition.summary}
          </span>
        </span>
      </span>
    </Button>
  )
}

export function ConnectionSettings({
  client = defaultClient as ConnectionClient,
  kind = 'all',
}: Readonly<{ client?: ConnectionClient; kind?: CatalogKind }>) {
  const [catalogEntries, setCatalogEntries] = useState<readonly ConnectionCatalogEntry[]>([])
  const [connections, setConnections] = useState<readonly ConnectionRecord[]>([])
  const [oauth, setOauth] = useState<ChatGptOAuthTransaction>()
  const [error, setError] = useState<string>()
  const [selectedType, setSelectedType] = useState<ConnectionType>()
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [view, setView] = useState<CatalogView>('grid')
  const [replacing, setReplacing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelOpenFrameRef = useRef<number | undefined>(undefined)
  const catalog = visibleCatalog(catalogEntries, kind)
  const selected = catalog.find((definition) => definition.type === selectedType)
  const selectedConnection =
    selected === undefined ? undefined : connectionFor(connections, selected.type)

  const closePanel = useCallback(() => {
    if (panelOpenFrameRef.current !== undefined) {
      window.cancelAnimationFrame(panelOpenFrameRef.current)
      panelOpenFrameRef.current = undefined
    }
    setIsPanelOpen(false)
    setReplacing(false)
    if (prefersReducedMotion()) {
      setSelectedType(undefined)
    }
  }, [])

  const openPanel = useCallback((type: ConnectionType) => {
    if (panelOpenFrameRef.current !== undefined) {
      window.cancelAnimationFrame(panelOpenFrameRef.current)
    }
    setSelectedType(type)
    setReplacing(false)

    if (prefersReducedMotion()) {
      setIsPanelOpen(true)
      panelOpenFrameRef.current = undefined
      return
    }

    setIsPanelOpen(false)
    panelOpenFrameRef.current = window.requestAnimationFrame(() => {
      panelOpenFrameRef.current = window.requestAnimationFrame(() => {
        setIsPanelOpen(true)
        panelOpenFrameRef.current = undefined
      })
    })
  }, [])

  const load = async () => {
    try {
      const response = await client.listConnections()
      setCatalogEntries(response.catalog)
      setConnections(response.connections)
      setError(undefined)
    } catch (cause) {
      setCatalogEntries([])
      setConnections([])
      setSelectedType(undefined)
      setIsPanelOpen(false)
      setError(cause instanceof Error ? cause.message : 'Connections could not be loaded.')
    }
  }

  useEffect(() => {
    void load()
  }, [client])

  useEffect(
    () => () => {
      if (panelOpenFrameRef.current !== undefined) {
        window.cancelAnimationFrame(panelOpenFrameRef.current)
      }
    },
    [],
  )

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
    if (oauth?.status !== 'PENDING') return
    const timer = window.setInterval(() => {
      void client.getChatGptOAuth(oauth.id).then((next) => {
        setOauth(next)
        if (next.status === 'CONNECTED') void load()
      })
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [client, oauth])

  const upsert = (record: ConnectionRecord) => {
    setConnections((current) => [
      ...current.filter((connection) => connection.type !== record.type),
      record,
    ])
  }

  const connect = async (event: FormEvent<HTMLFormElement>, definition: ConnectionCatalogEntry) => {
    event.preventDefault()
    if (definition.type === 'chatgpt-subscription') return
    setError(undefined)
    const form = event.currentTarget
    const key = String(new FormData(form).get('credential'))
    try {
      const record = await client.connect({
        connectionId: definition.type,
        type: definition.type,
        label: definition.name,
        configuration: {},
        credential: { type: 'api_key', key },
      })
      upsert(record)
      form.reset()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connection validation failed.')
    }
  }

  const startChatGpt = async (definition: ConnectionCatalogEntry) => {
    setError(undefined)
    try {
      setOauth(await client.startChatGptOAuth(definition.name))
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : `${definition.name} connection could not start.`,
      )
    }
  }

  const revalidate = async (connection: ConnectionRecord) => {
    setError(undefined)
    try {
      upsert(await client.revalidateConnection(connection.connectionId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connection could not be revalidated.')
    }
  }

  const replaceCredential = async (
    event: FormEvent<HTMLFormElement>,
    connection: ConnectionRecord,
  ) => {
    event.preventDefault()
    setError(undefined)
    const form = event.currentTarget
    const key = String(new FormData(form).get('replacement'))
    try {
      upsert(await client.replaceConnectionCredential(connection.connectionId, key))
      form.reset()
      setReplacing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Credential replacement failed.')
    }
  }

  const disconnect = async (connection: ConnectionRecord) => {
    setError(undefined)
    try {
      await client.deleteConnection(connection.connectionId)
      setConnections((current) =>
        current.filter((candidate) => candidate.connectionId !== connection.connectionId),
      )
      setReplacing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connection could not be disconnected.')
    }
  }

  const title =
    kind === 'providers' ? 'Providers' : kind === 'connectors' ? 'Connectors' : 'Connections'

  return (
    <section aria-label={title} className={catalogSectionClassName}>
      <div className="mb-3 flex justify-start">
        <SegmentedControl
          ariaLabel="View options"
          indicatorTestId="connection-view-selection-indicator"
          onValueChange={(value) => setView(value as CatalogView)}
          options={catalogViewOptions}
          value={view}
        />
      </div>

      {error === undefined ? null : (
        <Alert variant="destructive" className="mb-3">
          <AlertTitle>Connection unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div
        data-testid="connection-grid"
        data-layout={view}
        className={cn(
          'grid grid-cols-1 gap-3',
          view === 'grid' && 'sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]',
        )}
      >
        {catalog.map((definition) => (
          <ConnectionTile
            key={definition.type}
            definition={definition}
            connection={connectionFor(connections, definition.type)}
            view={view}
            onSelect={() => openPanel(definition.type)}
          />
        ))}
      </div>

      {selected === undefined ? null : (
        <div
          ref={panelRef}
          data-testid="connection-panel-shell"
          data-open={isPanelOpen}
          aria-hidden={!isPanelOpen}
          className="provider-floating-panel-shell absolute inset-y-3 right-3 z-30 w-[min(34rem,calc(100%-1.5rem))]"
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
              setSelectedType(undefined)
            }
          }}
        >
          <aside
            role="dialog"
            aria-modal="false"
            aria-labelledby="connection-panel-title"
            data-layout="floating"
            data-open={isPanelOpen}
            className="t-panel-slide flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-overlay)]"
          >
            <header className="relative shrink-0 border-b border-border p-6 pr-14">
              <div className="flex items-center gap-3">
                <ConnectionIcon definition={selected} />
                <div className="min-w-0">
                  <h2
                    id="connection-panel-title"
                    className="text-[18px]/6 font-semibold tracking-[-0.01em]"
                  >
                    {selected.name}
                  </h2>
                  <p className="text-[12px]/4 text-muted-foreground">{selected.eyebrow}</p>
                </div>
                <div className="ml-auto">
                  <ConnectionStatus connection={selectedConnection} />
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close connection details"
                onClick={closePanel}
                className="absolute top-3 right-3"
              >
                <XIcon aria-hidden="true" />
              </Button>
            </header>

            <div className="grid min-h-0 gap-6 overflow-y-auto p-6">
              <section className="grid gap-2">
                <h2 className="text-[14px]/5 font-semibold">Overview</h2>
                <p className="max-w-[66ch] text-[14px]/6 text-muted-foreground">
                  {selected.description}
                </p>
              </section>

              <Separator />

              <section className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[14px]/5 font-semibold">Setup</h2>
                  {selected.resourceHref === undefined ? null : (
                    <a
                      className={buttonVariants({ size: 'sm', variant: 'outline' })}
                      href={selected.resourceHref}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {selected.resourceLabel}
                      <ExternalLinkIcon aria-hidden="true" />
                    </a>
                  )}
                </div>
                <ol className="grid list-decimal gap-2.5 pl-5 text-[14px]/6 text-muted-foreground">
                  {selected.setup.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </section>

              <section className="rounded-lg border border-border bg-background p-4">
                <h2 className="text-[14px]/5 font-semibold">Access</h2>
                <p className="mt-1.5 text-[14px]/6 text-muted-foreground">{selected.access}</p>
              </section>

              <Separator />

              {selectedConnection === undefined ? (
                selected.type === 'chatgpt-subscription' ? (
                  <section className="grid gap-3">
                    <h2 className="text-[14px]/5 font-semibold">Connect {selected.name}</h2>
                    <Button onClick={() => void startChatGpt(selected)}>
                      Connect {selected.name}
                    </Button>
                    {oauth?.status === 'PENDING' && oauth.authorizationUrl !== undefined ? (
                      <a
                        className={buttonVariants({ variant: 'outline' })}
                        href={oauth.authorizationUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Continue with {selected.name}
                        <ExternalLinkIcon aria-hidden="true" />
                      </a>
                    ) : null}
                    {oauth === undefined ? null : (
                      <p role="status" className="text-xs text-muted-foreground">
                        {oauth.status === 'FAILED' ? oauth.message : oauth.status}
                      </p>
                    )}
                  </section>
                ) : (
                  <form className="grid gap-4" onSubmit={(event) => void connect(event, selected)}>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor={`${selected.type}-credential`}>
                          {selected.credentialLabel}
                        </FieldLabel>
                        <Input
                          id={`${selected.type}-credential`}
                          name="credential"
                          type="password"
                          autoComplete="new-password"
                          required
                        />
                        {selected.credentialDescription === undefined ? null : (
                          <FieldDescription>{selected.credentialDescription}</FieldDescription>
                        )}
                      </Field>
                      <Button type="submit">Connect {selected.name}</Button>
                    </FieldGroup>
                  </form>
                )
              ) : (
                <section className="grid gap-4">
                  <div>
                    <h2 className="text-[14px]/5 font-semibold">Connection</h2>
                    <p className="text-xs text-muted-foreground">
                      Last validated {new Date(selectedConnection.validatedAt).toLocaleString()}.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void revalidate(selectedConnection)}
                    >
                      <RefreshCwIcon aria-hidden="true" />
                      Revalidate
                    </Button>
                    {selected.type === 'chatgpt-subscription' ? null : (
                      <Button size="sm" variant="outline" onClick={() => setReplacing(true)}>
                        Replace credential
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void disconnect(selectedConnection)}
                    >
                      <Trash2Icon aria-hidden="true" />
                      Disconnect {selected.name}
                    </Button>
                  </div>
                  {replacing ? (
                    <form
                      className="grid gap-3 rounded-md border p-3"
                      onSubmit={(event) => void replaceCredential(event, selectedConnection)}
                    >
                      <Field>
                        <FieldLabel htmlFor={`${selected.type}-replacement`}>
                          {selected.replacementLabel}
                        </FieldLabel>
                        <Input
                          id={`${selected.type}-replacement`}
                          name="replacement"
                          type="password"
                          autoComplete="new-password"
                          required
                        />
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit">Validate replacement</Button>
                        <Button type="button" variant="ghost" onClick={() => setReplacing(false)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </section>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  )
}
