import { VerificationCommandConfigurationSchema } from '@loop/contracts'
import { z } from 'zod'

import type { ProfileRepository } from '../persistence/profile-repository.js'
import type { RunRepository } from '../persistence/run-repository.js'
import type { ProcessRunResult, ProcessRunner } from '../processes/process-runner.js'
import {
  VerificationOutputSchema,
  normalizeVerificationEvidence,
  type RepositoryVerificationExecution,
  type VerificationOutput,
} from '../services/verification-evidence.js'
import type { NodeExecutor } from './registry.js'

const COMMAND_ID = 'verify-selected-repositories'

export const VerificationNodeOutputSchema = VerificationOutputSchema.extend({
  commandId: z.literal(COMMAND_ID),
})

export type VerificationNodeOutput = z.infer<typeof VerificationNodeOutputSchema>

export type VerificationNodeErrorCode =
  | 'VERIFICATION_CONTEXT_INVALID'
  | 'VERIFICATION_EVIDENCE_INVALID'
  | 'VERIFICATION_EXECUTION_FAILED'
  | 'VERIFICATION_TERMINATION_UNCONFIRMED'

export interface CreateVerificationNodeExecutorOptions {
  readonly runner: ProcessRunner
  readonly profiles: Pick<ProfileRepository, 'getSnapshot'>
  readonly runs: Pick<RunRepository, 'listSelections' | 'listWorkspaces'>
  readonly sensitiveValues?: readonly string[]
  readonly now?: () => string
}

const failed = (code: VerificationNodeErrorCode, message: string) => ({
  status: 'failed' as const,
  code,
  message,
})

const verificationContext = (
  options: CreateVerificationNodeExecutorOptions,
  runId: Parameters<RunRepository['listSelections']>[0],
  profileSnapshotId: string,
) => {
  const snapshot = options.profiles.getSnapshot(profileSnapshotId)
  const selections = options.runs.listSelections(runId)
  const workspaces = options.runs.listWorkspaces(runId)
  if (
    snapshot === undefined ||
    selections.length === 0 ||
    selections.length !== workspaces.length
  ) {
    return undefined
  }
  const repositories = selections.map((selection, index) => {
    const workspace = workspaces[index]
    const repository = snapshot.repositories[selection.profilePosition]
    const commands = z
      .array(VerificationCommandConfigurationSchema)
      .max(32)
      .safeParse(repository?.verificationCommands)
    if (
      workspace === undefined ||
      repository === undefined ||
      repository.repositoryId !== selection.repositoryId ||
      repository.profilePosition !== selection.profilePosition ||
      workspace.repositoryId !== selection.repositoryId ||
      workspace.profilePosition !== selection.profilePosition ||
      !commands.success
    ) {
      return undefined
    }
    return {
      repositoryId: selection.repositoryId,
      profilePosition: selection.profilePosition,
      worktreePath: workspace.worktreePath,
      commands: commands.data,
    }
  })
  return repositories.every((repository) => repository !== undefined) ? repositories : undefined
}

const nodeOutput = (verification: VerificationOutput): VerificationNodeOutput =>
  VerificationNodeOutputSchema.parse({ commandId: COMMAND_ID, ...verification })

export const createVerificationNodeExecutor = (
  options: CreateVerificationNodeExecutorOptions,
): NodeExecutor => ({
  async execute(context) {
    if (
      context.node.type !== 'command' ||
      context.node.id !== 'verify' ||
      context.node.commandId !== COMMAND_ID ||
      !context.node.outcomes.some((outcome) => outcome === 'passed') ||
      !context.node.outcomes.some((outcome) => outcome === 'failed-checks')
    ) {
      return failed(
        'VERIFICATION_CONTEXT_INVALID',
        'Verification context does not match the immutable selected workspaces',
      )
    }
    const repositories = verificationContext(
      options,
      context.run.runId,
      context.run.profileSnapshotId,
    )
    if (repositories === undefined) {
      return failed(
        'VERIFICATION_CONTEXT_INVALID',
        'Verification context does not match the immutable selected workspaces',
      )
    }

    const executions: RepositoryVerificationExecution[] = []
    for (const repository of repositories) {
      const commands = []
      for (const [commandIndex, command] of repository.commands.entries()) {
        let result: ProcessRunResult
        try {
          result = await options.runner.run({
            executable: command.executable,
            arguments: command.arguments,
            cwd: repository.worktreePath,
            timeoutMs: context.node.timeoutSeconds * 1_000,
            signal: context.signal,
          })
        } catch {
          return failed(
            'VERIFICATION_EXECUTION_FAILED',
            'Verification command execution failed unexpectedly',
          )
        }
        if (result.status === 'cancelled') {
          return { status: 'cancelled', reason: 'Verification was cancelled' }
        }
        if (result.status === 'termination-unconfirmed') {
          return failed(
            'VERIFICATION_TERMINATION_UNCONFIRMED',
            'Verification process-group termination could not be confirmed',
          )
        }
        commands.push({ commandIndex, command, result })
      }
      executions.push({
        repositoryId: repository.repositoryId,
        profilePosition: repository.profilePosition,
        commands,
      })
    }

    try {
      const verification = normalizeVerificationEvidence({
        recordedAt: (options.now ?? (() => new Date().toISOString()))(),
        sensitiveValues: options.sensitiveValues ?? [],
        repositories: executions,
      })
      const output = nodeOutput(verification)
      return {
        status: 'succeeded',
        outcome: verification.repositories.every(({ status }) => status === 'passed')
          ? 'passed'
          : 'failed-checks',
        artifactIds: [],
        output,
      }
    } catch {
      return failed(
        'VERIFICATION_EVIDENCE_INVALID',
        'Verification did not produce a complete structured record',
      )
    }
  },
})
