'use client'

import { ExternalLinkIcon, KeyRoundIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  createApiClient,
  type ApiClient,
  type ChatGptOAuthTransaction,
  type ConnectionRecord,
} from '@/lib/api-client'

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

export function ConnectionSettings({
  client = defaultClient as ConnectionClient,
}: Readonly<{ client?: ConnectionClient }>) {
  const [connections, setConnections] = useState<readonly ConnectionRecord[]>([])
  const [oauth, setOauth] = useState<ChatGptOAuthTransaction>()
  const [error, setError] = useState<string>()
  const [replacementFor, setReplacementFor] = useState<string>()

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

  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(undefined)
    const form = event.currentTarget
    const data = new FormData(form)
    const type = String(data.get('type')) as 'gitlab' | 'clickup' | 'openrouter'
    try {
      const record = await client.connect({
        type,
        label: String(data.get('label')),
        configuration:
          type === 'openrouter' || String(data.get('baseUrl')).trim() === ''
            ? {}
            : { baseUrl: String(data.get('baseUrl')) },
        credential: { type: 'api_key', key: String(data.get('key')) },
      })
      setConnections((current) => [...current, record])
      form.reset()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connection validation failed.')
    }
  }

  const startChatGpt = async () => {
    try {
      const transaction = await client.startChatGptOAuth('ChatGPT subscription')
      setOauth(transaction)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ChatGPT connection could not start.')
    }
  }

  const mutate = async (operation: () => Promise<unknown>) => {
    try {
      await operation()
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connection could not be updated.')
    }
  }

  const replaceCredential = async (
    event: FormEvent<HTMLFormElement>,
    connection: ConnectionRecord,
  ) => {
    event.preventDefault()
    const form = event.currentTarget
    const key = String(new FormData(form).get('replacement'))
    await mutate(() => client.replaceConnectionCredential(connection.connectionId, key))
    form.reset()
    setReplacementFor(undefined)
  }

  return (
    <section aria-labelledby="connections-title" className="grid gap-4">
      <div>
        <h2 id="connections-title" className="font-heading text-lg font-semibold">
          Connections
        </h2>
        <p className="text-xs/relaxed text-muted-foreground">
          Credentials stay in Slopify&apos;s owner-only local store. Workflows persist connection
          IDs only.
        </p>
      </div>
      {error === undefined ? null : (
        <Alert variant="destructive">
          <AlertTitle>Connection unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>API connection</CardTitle>
            <CardDescription>Credentials are validated before they are stored.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(event) => void connect(event)}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="connection-type">Type</FieldLabel>
                  <NativeSelect id="connection-type" name="type" defaultValue="gitlab">
                    <NativeSelectOption value="gitlab">GitLab</NativeSelectOption>
                    <NativeSelectOption value="clickup">ClickUp</NativeSelectOption>
                    <NativeSelectOption value="openrouter">OpenRouter</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="connection-label">Label</FieldLabel>
                  <Input id="connection-label" name="label" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="connection-url">Base URL (optional)</FieldLabel>
                  <Input id="connection-url" name="baseUrl" type="url" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="connection-key">PAT or API key</FieldLabel>
                  <Input
                    id="connection-key"
                    name="key"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </Field>
                <Button type="submit">Validate and connect</Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>ChatGPT subscription</CardTitle>
            <CardDescription>
              Uses Pi&apos;s OpenAI Codex OAuth provider—not an OpenAI Platform API key.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Button onClick={() => void startChatGpt()}>Connect ChatGPT</Button>
            {oauth?.status === 'PENDING' && oauth.authorizationUrl !== undefined ? (
              <Button
                variant="outline"
                render={<a href={oauth.authorizationUrl} target="_blank" rel="noreferrer" />}
              >
                <ExternalLinkIcon aria-hidden="true" /> Continue in browser
              </Button>
            ) : null}
            {oauth === undefined ? null : (
              <p role="status" className="text-xs text-muted-foreground">
                {oauth.status === 'FAILED' ? oauth.message : oauth.status}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-3">
        {connections.map((connection) => (
          <Card key={connection.connectionId}>
            <CardContent className="grid gap-4 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{connection.label}</p>
                    <Badge
                      variant={connection.status === 'CONNECTED' ? 'secondary' : 'destructive'}
                    >
                      {connection.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {connection.type} · {connection.authority}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void mutate(() => client.revalidateConnection(connection.connectionId))
                    }
                  >
                    <RefreshCwIcon aria-hidden="true" /> Revalidate
                  </Button>
                  {connection.type === 'chatgpt-subscription' ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Replace credential for ${connection.label}`}
                      onClick={() => setReplacementFor(connection.connectionId)}
                    >
                      <KeyRoundIcon aria-hidden="true" /> Replace
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      void mutate(() => client.deleteConnection(connection.connectionId))
                    }
                  >
                    <Trash2Icon aria-hidden="true" /> Delete
                  </Button>
                </div>
              </div>
              {replacementFor === connection.connectionId ? (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(event) => void replaceCredential(event, connection)}
                >
                  <Field className="min-w-64 flex-1">
                    <FieldLabel htmlFor={`replacement-${connection.connectionId}`}>
                      New credential for {connection.label}
                    </FieldLabel>
                    <Input
                      id={`replacement-${connection.connectionId}`}
                      name="replacement"
                      type="password"
                      autoComplete="new-password"
                      required
                    />
                  </Field>
                  <Button type="submit">Validate replacement for {connection.label}</Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setReplacementFor(undefined)}
                  >
                    Cancel
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
