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
    }>
  | Readonly<{
      status: 'failed'
      code: string
      message: string
    }>
  | Readonly<{ status: 'cancelled'; reason: string }>

export interface NodeRunner {
  run(input: NodeRunInput): Promise<NodeRunResult>
  cancel(input: NodeRunInput): Promise<Readonly<{ status: 'cancelled' | 'unconfirmed' }>>
}
