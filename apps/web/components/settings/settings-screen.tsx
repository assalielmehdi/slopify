'use client'

import type { GitConnection, GitProvider } from '@slopify/contracts'
import { CheckCircle2Icon } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { GitProviderLogo } from '@/components/settings/git-provider-logo'
import { useThemePreference, type ThemePreference } from '@/components/theme-preference'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { createApiClient, type ApiClient } from '@/lib/api-client'

const themeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const

const providers = [
  {
    provider: 'GITHUB' as const,
    label: 'GitHub',
    description: 'Access repositories on GitHub.com.',
    placeholder: 'github_pat_…',
  },
  {
    provider: 'GITLAB' as const,
    label: 'GitLab',
    description: 'Access repositories on GitLab.com.',
    placeholder: 'glpat-…',
  },
] as const

type SettingsClient = Pick<
  ApiClient,
  'configureGitConnection' | 'disconnectGitConnection' | 'listGitConnections'
>

const defaultClient = createApiClient()

function InterfaceSettings() {
  const { preference, setPreference } = useThemePreference()
  return (
    <section aria-labelledby="interface-group-title">
      <h2 id="interface-group-title" className="mb-3 text-[14px]/5 font-semibold">
        Interface
      </h2>
      <div className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-[var(--shadow-raised)]">
        <div className="flex flex-col items-start gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 id="theme-preference-label" className="text-[14px]/5 font-medium">
              Theme
            </h3>
            <p className="mt-0.5 text-[12px]/4 text-muted-foreground">
              Choose how Slopify appears on this device.
            </p>
          </div>
          <SegmentedControl
            ariaLabelledBy="theme-preference-label"
            className="w-full shrink-0 sm:w-auto"
            indicatorTestId="theme-selection-indicator"
            onValueChange={(value) => setPreference(value as ThemePreference)}
            options={themeOptions}
            value={preference}
          />
        </div>
      </div>
    </section>
  )
}

function GitProviderRow({
  busy,
  connection,
  description,
  label,
  onConfigure,
  onDisconnect,
  placeholder,
  provider,
}: Readonly<{
  busy: boolean
  connection: GitConnection | undefined
  description: string
  label: string
  onConfigure: (provider: GitProvider, token: string) => Promise<void>
  onDisconnect: (provider: GitProvider) => Promise<void>
  placeholder: string
  provider: GitProvider
}>) {
  const [token, setToken] = useState('')
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onConfigure(provider, token)
    setToken('')
  }

  return (
    <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,auto)] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
          <GitProviderLogo aria-hidden="true" className="size-4" provider={provider} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px]/5 font-medium">{label}</h3>
            {connection === undefined ? null : (
              <span className="inline-flex items-center gap-1 text-[12px]/4 text-status-success">
                <CheckCircle2Icon aria-hidden="true" className="size-3.5" /> Connected
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12px]/4 text-muted-foreground">
            {connection === undefined
              ? description
              : `Connected as ${connection.accountUsername}. Tokens are stored in the system credential store.`}
          </p>
        </div>
      </div>
      {connection === undefined ? (
        <form className="flex min-w-0 gap-2" onSubmit={(event) => void submit(event)}>
          <Input
            aria-label={`${label} personal access token`}
            autoComplete="new-password"
            onChange={(event) => setToken(event.target.value)}
            placeholder={placeholder}
            required
            type="password"
            value={token}
          />
          <Button disabled={busy || token.trim() === ''} type="submit">
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        </form>
      ) : (
        <Button
          className="sm:justify-self-end"
          disabled={busy}
          onClick={() => void onDisconnect(provider)}
          type="button"
          variant="outline"
        >
          {busy ? 'Disconnecting…' : 'Disconnect'}
        </Button>
      )}
    </div>
  )
}

function GitSettings({ client }: Readonly<{ client: SettingsClient }>) {
  const [connections, setConnections] = useState<readonly GitConnection[]>([])
  const [busyProvider, setBusyProvider] = useState<GitProvider>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    void client
      .listGitConnections()
      .then((nextConnections) => {
        if (active) setConnections(nextConnections)
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Git connections could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [client])

  const configure = async (provider: GitProvider, token: string) => {
    setBusyProvider(provider)
    setError(undefined)
    try {
      const connection = await client.configureGitConnection(provider, { token })
      setConnections((current) => [
        ...current.filter((candidate) => candidate.provider !== provider),
        connection,
      ])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Git connection could not be saved.')
    } finally {
      setBusyProvider(undefined)
    }
  }

  const disconnect = async (provider: GitProvider) => {
    setBusyProvider(provider)
    setError(undefined)
    try {
      await client.disconnectGitConnection(provider)
      setConnections((current) => current.filter((candidate) => candidate.provider !== provider))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Git connection could not be removed.')
    } finally {
      setBusyProvider(undefined)
    }
  }

  return (
    <section aria-labelledby="git-group-title">
      <h2 id="git-group-title" className="mb-3 text-[14px]/5 font-semibold">
        Git
      </h2>
      {error === undefined ? null : (
        <Alert className="mb-3" variant="destructive">
          <AlertTitle>Connection unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div
        aria-busy={loading}
        className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-[var(--shadow-raised)]"
      >
        {providers.map((configuration) => (
          <GitProviderRow
            key={configuration.provider}
            {...configuration}
            busy={loading || busyProvider === configuration.provider}
            connection={connections.find(({ provider }) => provider === configuration.provider)}
            onConfigure={configure}
            onDisconnect={disconnect}
          />
        ))}
      </div>
      <p className="mt-3 text-[12px]/4 text-muted-foreground">
        Use a token that can read repositories. Grant write access only when agents need to push the
        run branch; Slopify never pushes it automatically.
      </p>
    </section>
  )
}

export function SettingsScreen({ client = defaultClient }: Readonly<{ client?: SettingsClient }>) {
  return (
    <div className="mx-auto grid w-full max-w-[760px] gap-8 px-6 py-10 sm:px-8 sm:py-12">
      <InterfaceSettings />
      <GitSettings client={client} />
    </div>
  )
}
