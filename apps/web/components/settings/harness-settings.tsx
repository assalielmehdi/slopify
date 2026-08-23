'use client'

import type { HarnessDescriptor } from '@slopify/contracts'
import { CircleAlertIcon, CircleCheckIcon, CpuIcon, ExternalLinkIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { createApiClient, type ApiClient } from '@/lib/api-client'

type HarnessSettingsClient = Pick<ApiClient, 'listHarnesses'>

export interface HarnessSettingsProps {
  readonly client?: HarnessSettingsClient
}

const defaultClient = createApiClient()

function HarnessStatus({ harness }: Readonly<{ harness: HarnessDescriptor }>) {
  if (harness.availability === 'AVAILABLE') {
    return (
      <Badge className="bg-status-success/10 text-status-success" variant="secondary">
        <CircleCheckIcon aria-hidden="true" data-icon="inline-start" />
        Available
      </Badge>
    )
  }
  return (
    <Badge className="bg-status-warning/10 text-status-warning" variant="secondary">
      <CircleAlertIcon aria-hidden="true" data-icon="inline-start" />
      Unavailable
    </Badge>
  )
}

function HarnessRow({ harness }: Readonly<{ harness: HarnessDescriptor }>) {
  const modelLabel = `${harness.models.length} ${harness.models.length === 1 ? 'model' : 'models'}`

  return (
    <article className="rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-raised)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
            <CpuIcon aria-hidden="true" className="size-5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[18px]/6 font-semibold tracking-[-0.01em]">{harness.name}</h2>
            <p className="mt-1 max-w-[70ch] text-sm/5 text-muted-foreground">
              {harness.description}
            </p>
          </div>
        </div>
        <HarnessStatus harness={harness} />
      </div>

      {harness.availability === 'AVAILABLE' ? (
        <dl className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs/4 text-muted-foreground">Version</dt>
            <dd className="mt-1 text-sm/5 font-medium">Version {harness.version}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs/4 text-muted-foreground">Executable</dt>
            <dd
              className="mt-1 truncate font-mono text-xs/5 font-medium"
              title={harness.executablePath}
            >
              {harness.executablePath}
            </dd>
          </div>
          <div>
            <dt className="text-xs/4 text-muted-foreground">Discovered models</dt>
            <dd className="mt-1 text-sm/5 font-medium">{modelLabel}</dd>
          </div>
        </dl>
      ) : (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-sm/5 text-muted-foreground">{harness.unavailableReason}</p>
          <a
            className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm/5 font-medium underline underline-offset-4 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
            href={harness.installHref}
            rel="noreferrer"
            target="_blank"
          >
            {harness.installLabel}
            <ExternalLinkIcon aria-hidden="true" className="size-4" />
          </a>
        </div>
      )}
    </article>
  )
}

export function HarnessSettings({ client = defaultClient }: HarnessSettingsProps) {
  const [harnesses, setHarnesses] = useState<readonly HarnessDescriptor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const next = await client.listHarnesses()
        if (active) setHarnesses(next)
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Harnesses could not be discovered.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [client])

  return (
    <section aria-label="Harnesses" className="w-full px-6 pt-6 pb-10 sm:pb-12">
      <p className="mb-5 max-w-[70ch] text-sm/5 text-muted-foreground">
        Slopify discovers supported agent harnesses from this machine. Manage harness setup outside
        Slopify.
      </p>

      {error === undefined ? null : (
        <Alert variant="destructive">
          <AlertTitle>Harnesses unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div aria-label="Loading harnesses" role="status">
          <Skeleton className="h-44 w-full rounded-lg" />
        </div>
      ) : error !== undefined ? null : harnesses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm/5 font-semibold">No supported harnesses</p>
          <p className="mt-1 text-sm/5 text-muted-foreground">
            Install a supported harness on this machine before creating an agent.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {harnesses.map((harness) => (
            <HarnessRow key={harness.harnessId} harness={harness} />
          ))}
        </div>
      )}
    </section>
  )
}
