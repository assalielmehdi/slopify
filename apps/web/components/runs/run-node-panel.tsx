import type { AgentTrace, NodeExecutionStatus } from '@slopify/contracts'
import type { AgentNode } from '@slopify/workflow-model'

import { AgentTranscript } from '@/components/runs/agent-transcript'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

interface NodeExecutionSnapshot {
  readonly attemptId: string | null
  readonly completedAt: string | null
  readonly durationMs: number | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly outcome: string | null
  readonly output: unknown
  readonly startedAt: string | null
  readonly nodeExecutionId: string
}

export interface RunNodePanelProps {
  readonly connectorNames: Readonly<Record<string, string>>
  readonly execution: NodeExecutionSnapshot | undefined
  readonly node: AgentNode
  readonly providerName: string | undefined
  readonly status: NodeExecutionStatus
  readonly trace: AgentTrace | undefined
  readonly traceError: string | undefined
  readonly traceLoading: boolean
}

function DefinitionList({
  items,
}: Readonly<{ items: readonly (readonly [label: string, value: string])[] }>) {
  return (
    <dl className="grid grid-cols-3 gap-4">
      {items.map(([label, value]) => (
        <div className="min-w-0" key={label}>
          <dt className="text-xs/4 text-muted-foreground">{label}</dt>
          <dd className="mt-1 truncate font-mono text-xs/5 font-medium" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function CapabilityRow({
  empty,
  label,
  links,
}: Readonly<{
  empty: string
  label: string
  links: readonly Readonly<{ href: string; id: string; label: string }>[]
}>) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3">
      <p className="pt-0.5 text-xs/4 font-medium text-muted-foreground">{label}</p>
      {links.length === 0 ? (
        <p className="text-sm/5 text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {links.map((link) => (
            <Badge
              key={link.id}
              variant="outline"
              render={<a href={link.href} aria-label={link.label} />}
            >
              {link.label}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

export function RunNodePanel({
  connectorNames,
  execution,
  node,
  providerName,
  status,
  trace,
  traceError,
  traceLoading,
}: RunNodePanelProps) {
  const runtimeConfiguration = trace?.header.configuration
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 content-start gap-8 p-6">
        {execution?.errorMessage === null || execution?.errorMessage === undefined ? null : (
          <Alert variant="destructive">
            <AlertTitle>{execution.errorCode ?? 'Execution failed'}</AlertTitle>
            <AlertDescription>{execution.errorMessage}</AlertDescription>
          </Alert>
        )}

        <section className="grid" aria-label="Configuration">
          <DefinitionList
            items={[
              [
                'Provider',
                providerName ?? runtimeConfiguration?.provider ?? node.job.inference.connectionId,
              ],
              ['Model', runtimeConfiguration?.model ?? node.job.inference.modelId],
              ['Thinking', runtimeConfiguration?.thinkingLevel ?? node.job.inference.thinkingLevel],
            ]}
          />
        </section>

        <section className="grid gap-3" aria-label="Available capabilities">
          <CapabilityRow
            label="Skills"
            empty="No skills available."
            links={node.job.skillSnapshotRefs.map((skill) => ({
              id: skill.skillId,
              label: skill.name,
              href: `/skills?skill=${encodeURIComponent(skill.skillId)}`,
            }))}
          />
          <CapabilityRow
            label="Connectors"
            empty="No connectors available."
            links={node.job.connectorIds.map((connectionId) => ({
              id: connectionId,
              label: connectorNames[connectionId] ?? connectionId,
              href: `/connectors?connection=${encodeURIComponent(connectionId)}`,
            }))}
          />
        </section>
      </div>

      <Separator />

      <section className="flex min-h-0 flex-1 flex-col" aria-label="Exchange">
        {traceLoading && trace === undefined ? (
          <div className="grid gap-3 p-6" aria-label="Loading agent exchange">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : traceError !== undefined && trace === undefined ? (
          <div className="p-6">
            <Alert variant="destructive">
              <AlertTitle>Exchange unavailable</AlertTitle>
              <AlertDescription>{traceError}</AlertDescription>
            </Alert>
          </div>
        ) : (
          <AgentTranscript
            events={trace?.events ?? []}
            prompt={runtimeConfiguration?.renderedPrompt ?? node.job.prompt}
            result={execution?.output}
            streaming={status === 'RUNNING' && trace?.complete !== true}
          />
        )}
      </section>
    </div>
  )
}
