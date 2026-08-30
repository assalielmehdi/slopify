import type { AgentSessionReference } from '@slopify/shared'

export interface NodeRunInput {
  readonly runId: string
  readonly nodeExecutionId: string
  readonly attemptId: string
  readonly nodeId: string
}

export type NodeRunResult =
  | Readonly<{
      status: 'succeeded'
      outcome: string
      output: unknown
      session?: AgentSessionReference
    }>
  | Readonly<{
      status: 'failed'
      code: string
      message: string
      session?: AgentSessionReference
    }>
  | Readonly<{ status: 'cancelled'; reason: string; session?: AgentSessionReference }>

export interface NodeRunner {
  run(input: NodeRunInput): Promise<NodeRunResult>
  cancel(
    input: NodeRunInput,
  ): Promise<Readonly<{ status: 'cancelled' | 'unconfirmed'; session?: AgentSessionReference }>>
}
