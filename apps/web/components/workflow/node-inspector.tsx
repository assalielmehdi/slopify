import type { NodeExecutionStatus } from '@loop/contracts'
import type {
  AgentNodeConfigurationChanges,
  WorkflowEdge,
  WorkflowNode,
} from '@loop/workflow-model'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

import { AgentNodeForm } from './agent-node-form'

const PI_SDK_VERSION = '0.84.2'

const statusLabels: Readonly<Record<NodeExecutionStatus, string>> = {
  PENDING: 'Pending',
  RUNNING: 'Running',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  SKIPPED: 'Skipped',
}

const nodeKindLabels = {
  agent: 'Agent',
  command: 'Command',
  router: 'Router',
  terminal: 'Terminal',
} as const

const formatDuration = (durationMs: number) =>
  durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(1)} s`

const getPurpose = (node: WorkflowNode) =>
  node.type === 'terminal'
    ? `End the workflow with ${node.terminalStatus.toLowerCase()} status.`
    : node.description

const getOutcomes = (node: WorkflowNode): readonly string[] =>
  node.type === 'terminal' ? [] : node.outcomes

function Definition({ term, children }: Readonly<{ term: string; children: React.ReactNode }>) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs/4 font-medium text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-sm/5">{children}</dd>
    </div>
  )
}

export interface NodeInspectorProps {
  readonly node: WorkflowNode
  readonly revisionId: string
  readonly isStart: boolean
  readonly outgoingEdges: readonly WorkflowEdge[]
  readonly recentRun?: Readonly<{
    status: NodeExecutionStatus
    durationMs?: number
  }>
  readonly onSaveAgentConfiguration?: (changes: AgentNodeConfigurationChanges) => Promise<void>
}

export function NodeInspector({
  node,
  revisionId,
  isStart,
  outgoingEdges,
  recentRun,
  onSaveAgentConfiguration,
}: NodeInspectorProps) {
  const outcomes = getOutcomes(node)

  return (
    <Card className="h-fit" size="sm" aria-label="Node inspector">
      <CardHeader>
        <CardTitle>
          <h2>{node.name}</h2>
        </CardTitle>
        <CardDescription className="font-mono">{node.id}</CardDescription>
        <CardAction className="flex flex-wrap justify-end gap-1">
          <Badge variant="outline">{nodeKindLabels[node.type]}</Badge>
          {isStart ? <Badge variant="secondary">Start</Badge> : null}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-3">
          <Definition term="Purpose">{getPurpose(node)}</Definition>
          <Definition term="Revision">
            <code className="font-mono text-xs/4">{revisionId}</code>
          </Definition>
          <Definition term="Accepted inputs">
            {node.type === 'agent' && node.inputArtifacts.length > 0
              ? node.inputArtifacts.map((artifact) => (
                  <Badge key={artifact} variant="secondary">
                    {artifact}
                  </Badge>
                ))
              : 'No artifact inputs declared'}
          </Definition>
          <Definition term="Declared outcomes">
            <span className="flex flex-wrap gap-1">
              {outcomes.length === 0
                ? 'None (terminal)'
                : outcomes.map((outcome) => (
                    <Badge key={outcome} variant="outline">
                      {outcome}
                    </Badge>
                  ))}
            </span>
          </Definition>
          <Definition term="Timeout">
            {'timeoutSeconds' in node ? `${node.timeoutSeconds} seconds` : 'Not applicable'}
          </Definition>
        </dl>

        {recentRun === undefined ? null : (
          <>
            <Separator />
            <section className="grid gap-3" aria-labelledby="recent-run-title">
              <h3 id="recent-run-title" className="text-sm/5 font-medium">
                Recent run
              </h3>
              <dl className="grid grid-cols-2 gap-3">
                <Definition term="Status">
                  <Badge variant="secondary">{statusLabels[recentRun.status]}</Badge>
                </Definition>
                <Definition term="Duration">
                  {recentRun.durationMs === undefined
                    ? 'Not available'
                    : formatDuration(recentRun.durationMs)}
                </Definition>
              </dl>
            </section>
          </>
        )}

        <Separator />
        <section className="grid gap-3" aria-labelledby="execution-policy-title">
          <h3 id="execution-policy-title" className="text-sm/5 font-medium">
            Execution contract
          </h3>
          {node.type === 'agent' ? (
            <div className="flex flex-col gap-4">
              <dl className="grid gap-3">
                <Definition term="Harness">
                  Pi SDK <code className="font-mono text-xs/4">{PI_SDK_VERSION}</code>
                </Definition>
                <Definition term="Provider / model">
                  {node.provider} / {node.model}
                </Definition>
                <Definition term="Thinking level">{node.thinkingLevel}</Definition>
                <Definition term="Workspace policy">{node.workspacePolicy}</Definition>
                <Definition term="Permission profile">{node.permissionProfile}</Definition>
                <Definition term="Resource bundle">
                  <code className="font-mono text-xs/4">{node.resourceBundleId}</code>
                </Definition>
                <Definition term="Output schema">
                  <code className="font-mono text-xs/4">{node.outputSchemaRef}</code>
                </Definition>
                <Definition term="Prompt template">{node.promptTemplate}</Definition>
              </dl>
              {onSaveAgentConfiguration === undefined ? null : (
                <AgentNodeForm
                  key={`${revisionId}:${node.id}`}
                  node={node}
                  onSave={onSaveAgentConfiguration}
                />
              )}
            </div>
          ) : null}
          {node.type === 'command' ? (
            <dl className="grid gap-3">
              <Definition term="Entrypoint">
                <code className="font-mono text-xs/4">{node.commandId}</code>
              </Definition>
              <Definition term="Arguments">Server-bounded arguments</Definition>
              <Definition term="Source">Available from pinned run evidence</Definition>
            </dl>
          ) : null}
          {node.type === 'router' ? (
            <dl className="grid gap-3">
              <Definition term="Input field">
                <code className="font-mono text-xs/4">{node.inputField}</code>
              </Definition>
              <Definition term="Routing">Declared outcomes only</Definition>
            </dl>
          ) : null}
          {node.type === 'terminal' ? (
            <dl className="grid gap-3">
              <Definition term="Terminal status">{node.terminalStatus}</Definition>
            </dl>
          ) : null}
        </section>

        <Separator />
        <section className="grid gap-3" aria-labelledby="outgoing-edges-title">
          <h3 id="outgoing-edges-title" className="text-sm/5 font-medium">
            Outgoing edges
          </h3>
          <ul className="grid gap-2" aria-label="Outgoing edges">
            {outgoingEdges.length === 0 ? (
              <li className="text-sm/5 text-muted-foreground">No outgoing edges</li>
            ) : (
              outgoingEdges.map((edge) => (
                <li key={`${edge.outcome}:${edge.targetNodeId}`} className="grid gap-1">
                  <div className="flex items-center gap-1">
                    <Badge variant="outline">{edge.outcome}</Badge>
                    <span className="text-sm/5">{edge.label}</span>
                  </div>
                  <code className="font-mono text-xs/4 text-muted-foreground">
                    → {edge.targetNodeId}
                  </code>
                </li>
              ))
            )}
          </ul>
        </section>
      </CardContent>
    </Card>
  )
}
