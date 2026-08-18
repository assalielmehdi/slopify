import { OutcomeNameSchema } from '@loop/contracts'

import type { NodeResult } from '../engine/state-machine.js'
import type { ProcessRunResult, ProcessRunner } from '../processes/process-runner.js'
import type { NodeExecutor } from './registry.js'

export interface RegisteredCommandDefinition {
  readonly executable: string
  readonly arguments: readonly string[]
  readonly cwd: string
  readonly exitCodeOutcomes: Readonly<Record<number, string>>
}

export interface CreateRegisteredCommandExecutorsOptions {
  readonly runner: ProcessRunner
  readonly commands: Readonly<Record<string, RegisteredCommandDefinition>>
}

interface ExitedProcessResult extends Extract<ProcessRunResult, { readonly status: 'exited' }> {
  readonly exitCode: number
}

const succeeded = (
  commandId: string,
  outcomeInput: string,
  result: ExitedProcessResult,
): NodeResult => {
  const outcome = OutcomeNameSchema.parse(outcomeInput)
  return {
    status: 'succeeded',
    outcome,
    artifactIds: [],
    output: {
      commandId,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    },
  }
}

const mapFailure = (
  result: Exclude<ProcessRunResult, { readonly status: 'exited' }>,
): NodeResult => {
  switch (result.status) {
    case 'cancelled':
      return { status: 'cancelled', reason: 'Command execution was cancelled' }
    case 'timed-out':
      return {
        status: 'failed',
        code: 'COMMAND_TIMEOUT',
        message: 'Command exceeded its configured timeout',
      }
    case 'termination-unconfirmed':
      return {
        status: 'failed',
        code: 'COMMAND_TERMINATION_UNCONFIRMED',
        message: 'Command process-group termination could not be confirmed',
      }
    case 'failed-to-start':
      return {
        status: 'failed',
        code: 'COMMAND_START_FAILED',
        message: 'Registered command could not be started',
      }
  }
}

export const createRegisteredCommandExecutors = (
  options: CreateRegisteredCommandExecutorsOptions,
): Readonly<Record<string, NodeExecutor>> =>
  Object.fromEntries(
    Object.entries(options.commands).map(([commandId, definition]) => {
      const executor: NodeExecutor = {
        async execute(context) {
          if (context.node.type !== 'command' || context.node.commandId !== commandId) {
            return {
              status: 'failed',
              code: 'COMMAND_CONTEXT_INVALID',
              message: 'Registered command does not match the workflow node',
            }
          }
          const result = await options.runner.run({
            executable: definition.executable,
            arguments: definition.arguments,
            cwd: definition.cwd,
            timeoutMs: context.node.timeoutSeconds * 1_000,
            signal: context.signal,
          })

          if (result.status !== 'exited') return mapFailure(result)
          if (result.exitCode === null) {
            return {
              status: 'failed',
              code: 'COMMAND_TERMINATED',
              message: 'Command exited because it received a signal',
            }
          }
          const outcome = definition.exitCodeOutcomes[result.exitCode]
          if (outcome === undefined) {
            return {
              status: 'failed',
              code: 'COMMAND_EXIT_UNMAPPED',
              message: 'Command exited without a registered outcome',
            }
          }
          return succeeded(commandId, outcome, result as ExitedProcessResult)
        },
      }
      return [commandId, executor]
    }),
  )
