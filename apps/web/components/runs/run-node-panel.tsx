import type { AgentTrace, NodeExecutionStatus } from '@slopify/contracts'
import type { AgentNode } from '@slopify/workflow-model'

import { AgentTranscript } from '@/components/runs/agent-transcript'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

interface NodeExecutionSnapshot {
  readonly attemptId: string
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
  readonly repositories?: readonly {
    readonly baseSha: string
    readonly defaultBranch: string
    readonly fullName: string
    readonly isPrimary: boolean
    readonly name: string
    readonly provider: 'GITHUB' | 'GITLAB'
    readonly repositoryId: string
  }[]
  readonly repositoryWorkspaces?: readonly {
    readonly branchName: string
    readonly repositoryId: string
    readonly workspacePath: string
  }[]
  readonly execution: NodeExecutionSnapshot | undefined
  readonly node: AgentNode
  readonly status: NodeExecutionStatus
  readonly trace: AgentTrace | undefined
  readonly traceError: string | undefined
  readonly traceLoading: boolean
}

function DefinitionList({
  items,
}: Readonly<{ items: readonly (readonly [label: string, value: string])[] }>) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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

const harnessLabel = (harnessId: string): string =>
  harnessId === 'pi' ? 'Pi' : harnessId === 'codex' ? 'Codex' : harnessId

export function RunNodePanel({
  execution,
  node,
  repositories = [],
  repositoryWorkspaces = [],
  status,
  trace,
  traceError,
  traceLoading,
}: RunNodePanelProps) {
  const runtimeConfiguration = trace?.header.configuration
  const harnessConfiguration = trace?.header.configuration
  const displayedHarness =
    harnessConfiguration === undefined
      ? harnessLabel(node.harness.harnessId)
      : harnessLabel(harnessConfiguration.harnessId)
  const displayedModel = harnessConfiguration?.model ?? node.harness.modelId ?? 'Harness default'
  const displayedThinking =
    harnessConfiguration?.thinkingLevel ?? node.harness.thinkingLevel ?? 'Harness default'
  const workspaceRepositories =
    trace === undefined
      ? repositories.map((repository) => {
          const workspace = repositoryWorkspaces.find(
            ({ repositoryId }) => repositoryId === repository.repositoryId,
          )
          return {
            repositoryId: repository.repositoryId,
            name: repository.name,
            workspacePath: workspace?.workspacePath ?? 'Not recorded',
            branchLabel: `${workspace?.branchName ?? 'Not recorded'} · ${repository.defaultBranch} at ${repository.baseSha}`,
            repositoryLabel: `${repository.provider === 'GITHUB' ? 'GitHub' : 'GitLab'} · ${repository.fullName}`,
          }
        })
      : trace.header.configuration.repositories.map((repository) => ({
          repositoryId: repository.repositoryId,
          name: repository.name,
          workspacePath: repository.workspacePath,
          branchLabel: `${repository.branchName} · ${repository.defaultBranch} at ${repository.baseSha}`,
          repositoryLabel: `${repository.provider === 'GITHUB' ? 'GitHub' : 'GitLab'} · ${repository.fullName}`,
        }))
  const configurationItems: (readonly [string, string])[] = [
    ['Harness', displayedHarness],
    ...(harnessConfiguration === undefined
      ? []
      : ([['Version', harnessConfiguration.harnessVersion]] as const)),
    ['Model', displayedModel],
    ['Thinking', displayedThinking],
    ...(harnessConfiguration === undefined
      ? []
      : ([['Timeout', `${harnessConfiguration.timeoutSeconds} seconds`]] as const)),
  ]
  const primaryRepositoryId =
    harnessConfiguration?.primaryRepositoryId ??
    repositories.find(({ isPrimary }) => isPrimary)?.repositoryId
  const primaryRepository = workspaceRepositories.find(
    ({ repositoryId }) => repositoryId === primaryRepositoryId,
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-w-0 shrink-0 content-start gap-8 p-6">
        {execution?.errorMessage === null || execution?.errorMessage === undefined ? null : (
          <Alert variant="destructive">
            <AlertTitle>{execution.errorCode ?? 'Execution failed'}</AlertTitle>
            <AlertDescription>{execution.errorMessage}</AlertDescription>
          </Alert>
        )}

        <section className="grid" aria-label="Configuration">
          <DefinitionList items={configurationItems} />
        </section>

        {workspaceRepositories.length === 0 ? null : (
          <section className="grid min-w-0 gap-3" aria-label="Run workspaces">
            <div>
              <h3 className="text-sm/5 font-semibold">Run workspaces</h3>
              <p className="mt-1 text-xs/4 text-muted-foreground">
                The agent started in {primaryRepository?.name ?? 'the primary repository'} and
                shared these fresh repository clones with the run.
              </p>
            </div>
            <ul className="grid min-w-0 gap-2">
              {workspaceRepositories.map((repository) => (
                <li
                  className="min-w-0 rounded-md border border-border p-3"
                  key={repository.repositoryId}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm/5 font-medium">{repository.name}</p>
                    {repository.repositoryId === primaryRepositoryId ? (
                      <span className="text-xs/4 font-medium text-muted-foreground">Primary</span>
                    ) : null}
                  </div>
                  <p className="mt-1 break-all font-mono text-xs/4 text-muted-foreground">
                    {repository.workspacePath}
                  </p>
                  <p className="mt-1 truncate font-mono text-xs/4 text-muted-foreground">
                    {repository.branchLabel}
                  </p>
                  <p className="mt-1 truncate text-xs/4 text-muted-foreground">
                    {repository.repositoryLabel}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
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
            prompt={runtimeConfiguration?.renderedPrompt ?? node.prompt}
            result={execution?.output}
            streaming={status === 'RUNNING' && trace?.complete !== true}
          />
        )}
      </section>
    </div>
  )
}
