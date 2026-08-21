'use client'

import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  GitBranchIcon,
  Grid2X2Icon,
  ListIcon,
  RefreshCwIcon,
  RouteIcon,
  SparklesIcon,
  Trash2Icon,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
type CatalogView = 'cards' | 'list'

interface ConnectionDefinition {
  readonly type: ConnectionType
  readonly category: 'connector' | 'inference'
  readonly name: string
  readonly eyebrow: string
  readonly summary: string
  readonly description: string
  readonly setup: readonly string[]
  readonly access: string
  readonly credentialLabel?: string
  readonly replacementLabel?: string
  readonly resourceHref?: string
  readonly resourceLabel?: string
  readonly icon: LucideIcon
  readonly iconClassName: string
}

const definitions: readonly ConnectionDefinition[] = [
  {
    type: 'gitlab',
    category: 'connector',
    name: 'GitLab',
    eyebrow: 'Source control',
    summary: 'Read repositories and manage delivery through GitLab.',
    description:
      'Connect GitLab so workflows can inspect projects, create branches, push changes, and manage merge requests available to your user.',
    setup: [
      'Open GitLab personal access token settings.',
      'Create a token named Slopify with the api scope and an appropriate expiration.',
      'Copy the token and paste it below. GitLab only shows it once.',
    ],
    access:
      'This scope grants read and write API access, limited by the projects and permissions already available to your GitLab user.',
    credentialLabel: 'Personal access token',
    replacementLabel: 'New personal access token',
    resourceHref:
      'https://gitlab.com/-/user_settings/personal_access_tokens?name=Slopify&description=Slopify+local+workflow+connector&scopes=api',
    resourceLabel: 'Create a personal access token',
    icon: GitBranchIcon,
    iconClassName: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  },
  {
    type: 'clickup',
    category: 'connector',
    name: 'ClickUp',
    eyebrow: 'Task management',
    summary: 'Resolve tasks and publish workflow evidence to ClickUp.',
    description:
      'Connect your ClickUp account so workflows can read task context, add review artifacts, and update task status in your accessible Workspaces.',
    setup: [
      'Open ClickUp Settings, then Apps.',
      'Generate or reveal your personal API token under API Token.',
      'Copy the token and paste it below.',
    ],
    access:
      'A personal token inherits your ClickUp access. Slopify validates it by loading your user and available Workspaces.',
    credentialLabel: 'Personal API token',
    replacementLabel: 'New personal API token',
    resourceHref: 'https://app.clickup.com/settings/apps',
    resourceLabel: 'Open ClickUp API settings',
    icon: CheckCircle2Icon,
    iconClassName: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  {
    type: 'openrouter',
    category: 'inference',
    name: 'OpenRouter',
    eyebrow: 'Inference provider',
    summary: 'Run agents across models available through OpenRouter.',
    description:
      'Use one OpenRouter API key to make its model catalog available to Slopify agent profiles.',
    setup: [
      'Create a key in OpenRouter settings.',
      'Optionally set a spending limit for the key.',
      'Copy the key and paste it below. Slopify validates it before storing it locally.',
    ],
    access:
      'The key is used only by the trusted worker for model inference. It is never exposed to workflow prompts or agent sandboxes.',
    credentialLabel: 'OpenRouter API key',
    replacementLabel: 'New OpenRouter API key',
    resourceHref: 'https://openrouter.ai/settings/keys',
    resourceLabel: 'Create an API key',
    icon: RouteIcon,
    iconClassName: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
  {
    type: 'chatgpt-subscription',
    category: 'inference',
    name: 'ChatGPT',
    eyebrow: 'Subscription provider',
    summary: 'Use a ChatGPT subscription through Pi’s OpenAI Codex provider.',
    description:
      'Connect your ChatGPT account in the browser. Pi stores the resulting OAuth credential in Slopify’s owner-only local credential store.',
    setup: [
      'Start the connection below.',
      'Continue in the browser and approve the ChatGPT sign-in flow.',
      'Return to Slopify; connection status updates automatically.',
    ],
    access:
      'This uses ChatGPT subscription authentication through Pi’s OpenAI Codex provider, not an OpenAI Platform API key.',
    icon: SparklesIcon,
    iconClassName: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
]

const visibleDefinitions = (kind: CatalogKind): readonly ConnectionDefinition[] =>
  definitions.filter((definition) =>
    kind === 'all'
      ? true
      : kind === 'providers'
        ? definition.category === 'inference'
        : definition.category === 'connector',
  )

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
        connection?.status === 'CONNECTED' &&
          'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      )}
    >
      {label}
    </Badge>
  )
}

function ConnectionIcon({ definition }: Readonly<{ definition: ConnectionDefinition }>) {
  const Icon = definition.icon
  return (
    <span
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-lg border border-current/10 shadow-xs',
        definition.iconClassName,
      )}
    >
      <Icon aria-hidden="true" className="size-5" />
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
  definition: ConnectionDefinition
  onSelect: () => void
  view: CatalogView
}>) {
  return (
    <Card className="gap-0 py-0 transition-[border-color,box-shadow,transform] duration-[var(--duration-quick)] hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md">
      <Button
        variant="ghost"
        aria-label={`${definition.name}, ${statusLabel(connection)}`}
        className={cn(
          'h-auto w-full justify-start gap-4 rounded-lg p-4 text-left whitespace-normal hover:bg-muted/35',
          view === 'cards' ? 'min-h-28 items-start' : 'min-h-20 items-center',
        )}
        onClick={onSelect}
      >
        <ConnectionIcon definition={definition} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-heading text-base font-semibold tracking-[-0.01em]">
              {definition.name}
            </span>
            <ConnectionStatus connection={connection} />
          </span>
          <span className="text-xs font-medium text-muted-foreground">{definition.eyebrow}</span>
          <span
            className={cn('text-sm/5 text-muted-foreground', view === 'list' && 'line-clamp-1')}
          >
            {definition.summary}
          </span>
          {view === 'cards' ? (
            <span className="mt-auto pt-3 text-xs font-medium text-primary">View setup</span>
          ) : null}
        </span>
      </Button>
    </Card>
  )
}

export function ConnectionSettings({
  client = defaultClient as ConnectionClient,
  kind = 'all',
}: Readonly<{ client?: ConnectionClient; kind?: CatalogKind }>) {
  const [connections, setConnections] = useState<readonly ConnectionRecord[]>([])
  const [oauth, setOauth] = useState<ChatGptOAuthTransaction>()
  const [error, setError] = useState<string>()
  const [selectedType, setSelectedType] = useState<ConnectionType>()
  const [view, setView] = useState<CatalogView>('cards')
  const [replacing, setReplacing] = useState(false)
  const catalog = visibleDefinitions(kind)
  const selected = catalog.find((definition) => definition.type === selectedType)
  const selectedConnection =
    selected === undefined ? undefined : connectionFor(connections, selected.type)

  const load = async () => {
    try {
      setConnections(await client.listConnections())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connections could not be loaded.')
    }
  }

  useEffect(() => {
    void load()
  }, [client])

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

  const connect = async (event: FormEvent<HTMLFormElement>, definition: ConnectionDefinition) => {
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

  const startChatGpt = async () => {
    setError(undefined)
    try {
      setOauth(await client.startChatGptOAuth('ChatGPT'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ChatGPT connection could not start.')
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
    <section aria-label={title} className="grid gap-5">
      <div className="flex justify-end">
        <div
          className="flex items-center gap-1 rounded-md border bg-muted/60 p-1"
          role="group"
          aria-label="View options"
        >
          <Button
            size="icon-sm"
            variant={view === 'cards' ? 'secondary' : 'ghost'}
            aria-label="Card view"
            aria-pressed={view === 'cards'}
            onClick={() => setView('cards')}
          >
            <Grid2X2Icon aria-hidden="true" />
          </Button>
          <Button
            size="icon-sm"
            variant={view === 'list' ? 'secondary' : 'ghost'}
            aria-label="List view"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            <ListIcon aria-hidden="true" />
          </Button>
        </div>
      </div>

      {error === undefined ? null : (
        <Alert variant="destructive">
          <AlertTitle>Connection unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className={cn('grid gap-4', view === 'cards' && 'md:grid-cols-2 2xl:grid-cols-3')}>
        {catalog.map((definition) => (
          <ConnectionTile
            key={definition.type}
            definition={definition}
            connection={connectionFor(connections, definition.type)}
            view={view}
            onSelect={() => {
              setSelectedType(definition.type)
              setReplacing(false)
            }}
          />
        ))}
      </div>

      <Sheet
        open={selected !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedType(undefined)
            setReplacing(false)
          }
        }}
      >
        {selected === undefined ? null : (
          <SheetContent className="w-full sm:max-w-xl" aria-label={selected.name}>
            <SheetHeader className="border-b p-6 pr-14">
              <div className="flex items-center gap-3">
                <ConnectionIcon definition={selected} />
                <div className="min-w-0">
                  <SheetTitle className="text-xl">{selected.name}</SheetTitle>
                  <SheetDescription>{selected.eyebrow}</SheetDescription>
                </div>
                <div className="ml-auto">
                  <ConnectionStatus connection={selectedConnection} />
                </div>
              </div>
            </SheetHeader>

            <div className="grid min-h-0 gap-6 overflow-y-auto p-6">
              <section className="grid gap-2">
                <h2 className="font-heading text-base font-semibold">Overview</h2>
                <p className="max-w-[66ch] text-sm/6 text-muted-foreground">
                  {selected.description}
                </p>
              </section>

              <Separator />

              <section className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-heading text-base font-semibold">Setup</h2>
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
                <ol className="grid list-decimal gap-2.5 pl-5 text-sm/6 text-muted-foreground">
                  {selected.setup.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </section>

              <section className="rounded-lg border bg-muted/35 p-4">
                <h2 className="font-semibold">Access</h2>
                <p className="mt-1.5 text-sm/6 text-muted-foreground">{selected.access}</p>
              </section>

              <Separator />

              {selectedConnection === undefined ? (
                selected.type === 'chatgpt-subscription' ? (
                  <section className="grid gap-3">
                    <h2 className="font-heading text-sm font-medium">Connect ChatGPT</h2>
                    <Button onClick={() => void startChatGpt()}>Connect ChatGPT</Button>
                    {oauth?.status === 'PENDING' && oauth.authorizationUrl !== undefined ? (
                      <a
                        className={buttonVariants({ variant: 'outline' })}
                        href={oauth.authorizationUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Continue with ChatGPT
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
                        <FieldDescription>
                          Validated before it is stored in Slopify&apos;s owner-only local store.
                        </FieldDescription>
                      </Field>
                      <Button type="submit">Connect {selected.name}</Button>
                    </FieldGroup>
                  </form>
                )
              ) : (
                <section className="grid gap-4">
                  <div>
                    <h2 className="font-heading text-sm font-medium">Connection</h2>
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
                      className="grid gap-3 border p-3"
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
          </SheetContent>
        )}
      </Sheet>
    </section>
  )
}
