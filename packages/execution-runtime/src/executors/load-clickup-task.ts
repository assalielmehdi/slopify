import type { NodeExecutor } from './registry.js'

export const createLoadClickUpTaskExecutor = (): NodeExecutor => ({
  async execute(context) {
    if (context.node.type !== 'command' || context.node.commandId !== 'load-clickup-task') {
      return {
        status: 'failed',
        code: 'LOAD_TASK_CONTEXT_INVALID',
        message: 'Load task command does not match the workflow node',
      }
    }

    return {
      status: 'succeeded',
      outcome: 'loaded',
      artifactIds: [],
      output: {
        taskReference: context.run.taskReference,
        taskSnapshot: context.run.taskSnapshot,
      },
    }
  },
})
