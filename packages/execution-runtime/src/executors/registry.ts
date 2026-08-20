import type { WorkflowRevision } from '@loop/workflow-model'

import type { RunRecord } from '../persistence/run-repository.js'

export interface NodeExecutionContext {
  readonly run: RunRecord
  readonly workflow: WorkflowRevision
  readonly node: Exclude<WorkflowRevision['nodes'][number], { readonly type: 'terminal' }>
  readonly nodeExecutionId: string
  readonly signal: AbortSignal
}

export interface NodeExecutor {
  execute(context: NodeExecutionContext): Promise<unknown>
}

export interface ExecutorRegistryOptions {
  readonly commands: Readonly<Record<string, NodeExecutor>>
  readonly agents?: Readonly<Record<string, NodeExecutor>>
  readonly agent?: NodeExecutor
  readonly router?: NodeExecutor
}

export interface ExecutorRegistry {
  readonly registeredCommandIds: ReadonlySet<string>
  resolve(node: WorkflowRevision['nodes'][number]): NodeExecutor | undefined
}

export const createExecutorRegistry = (options: ExecutorRegistryOptions): ExecutorRegistry => {
  const commands = new Map(Object.entries(options.commands))
  const agents = new Map(Object.entries(options.agents ?? {}))
  const registeredCommandIds = new Set(commands.keys())

  return {
    registeredCommandIds,
    resolve(node) {
      if (node.type === 'command') return commands.get(node.commandId)
      if (node.type === 'agent' && node.job.kind === 'agent')
        return agents.get(node.id) ?? options.agent
      if (node.type === 'router') return options.router
      return undefined
    },
  }
}
