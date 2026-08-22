import type { NodeExecutionStatus, RunEvent } from '@loop/contracts'
import type { AgentNode } from '@loop/workflow-model'

import { AgentTranscript } from '@/components/runs/agent-transcript'
import { NodeStatusBadge, formatDuration, formatTimestamp } from '@/components/runs/run-status'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

interface NodeExecutionSnapshot {
  readonly completedAt: string | null
  readonly durationMs: number | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly outcome: string | null
  readonly output: unknown
  readonly startedAt: string | null
}

export interface RunNodePanelProps {
  readonly events: readonly RunEvent[]
  readonly execution: NodeExecutionSnapshot | undefined
  readonly node: AgentNode
  readonly status: NodeExecutionStatus
}

function DefinitionList({
  items,
}: Readonly<{ items: readonly (readonly [label: string, value: string])[] }>) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm/5">
      {items.map(([label, value]) => (
        <div className="contents" key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words text-right font-mono text-xs/5">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function RunNodePanel({ events, execution, node, status }: RunNodePanelProps) {
  return (
    <div className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto p-6">
      <section className="grid gap-3" aria-labelledby="run-node-configuration-title">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="run-node-configuration-title" className="text-sm/5 font-semibold">
            Captured configuration
          </h3>
          <Badge variant="outline">Agent job</Badge>
        </div>

        <div className="grid gap-4">
          <DefinitionList
            items={[
              ['Provider', node.job.inference.connectionId],
              ['Model', node.job.inference.modelId],
              ['Thinking', node.job.inference.thinkingLevel],
              ['Sandbox profile', node.sandbox.profileId],
              ['Sandbox image', node.sandbox.imageId],
              ['Result schema', node.result.schemaRef],
              ['Timeout', `${node.timeoutSeconds} seconds`],
            ]}
          />
          <Card size="sm">
            <CardHeader>
              <CardTitle>Prompt</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-wrap text-muted-foreground">
              {node.job.prompt}
            </CardContent>
          </Card>
          <div className="grid gap-2">
            <p className="text-xs/4 font-medium text-muted-foreground">Skill snapshots</p>
            {node.job.skillSnapshotRefs.length === 0 ? (
              <p className="text-sm/5 text-muted-foreground">No skills captured.</p>
            ) : (
              <ul className="grid gap-2">
                {node.job.skillSnapshotRefs.map((skill) => (
                  <li className="rounded-md border bg-background p-3" key={skill.snapshotId}>
                    <p className="font-medium">{skill.name}</p>
                    <p className="mt-1 font-mono text-xs/4 text-muted-foreground">
                      {skill.skillId} · {skill.snapshotId}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid gap-2">
            <p className="text-xs/4 font-medium text-muted-foreground">Connectors</p>
            <div className="flex flex-wrap gap-2">
              {node.job.connectorIds.length === 0 ? (
                <span className="text-sm/5 text-muted-foreground">No connectors captured.</span>
              ) : (
                node.job.connectorIds.map((connectorId) => (
                  <Badge key={connectorId} variant="outline" className="font-mono">
                    {connectorId}
                  </Badge>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <Separator />

      <section className="grid gap-3" aria-labelledby="run-node-execution-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="run-node-execution-title" className="text-sm/5 font-semibold">
            Execution
          </h3>
          <NodeStatusBadge status={status} />
        </div>
        <DefinitionList
          items={[
            ['Started', formatTimestamp(execution?.startedAt ?? null)],
            ['Completed', formatTimestamp(execution?.completedAt ?? null)],
            [
              'Duration',
              execution?.durationMs === null || execution?.durationMs === undefined
                ? 'Not recorded'
                : formatDuration(execution.durationMs),
            ],
            ['Outcome', execution?.outcome ?? 'Not recorded'],
          ]}
        />
        {execution?.errorMessage === null || execution?.errorMessage === undefined ? null : (
          <Card size="sm" className="border-destructive/30 bg-destructive/10">
            <CardHeader>
              <CardTitle className="text-destructive">
                {execution.errorCode ?? 'Execution failed'}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-destructive">{execution.errorMessage}</CardContent>
          </Card>
        )}
      </section>

      <Separator />
      <section className="flex min-h-96 flex-col" aria-labelledby="run-node-transcript-title">
        <h3 id="run-node-transcript-title" className="mb-3 text-sm/5 font-semibold">
          Agent messages
        </h3>
        <AgentTranscript
          events={events}
          node={node}
          result={execution?.output}
          streaming={status === 'RUNNING'}
        />
      </section>
    </div>
  )
}
