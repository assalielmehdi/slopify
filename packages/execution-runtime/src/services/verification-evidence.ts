import { createEventRedactor } from '@loop/agent-runtimes'
import {
  RepositoryIdSchema,
  VerificationCommandConfigurationSchema,
  type VerificationCommandConfiguration,
} from '@loop/contracts'
import { z } from 'zod'

import type { ProcessRunResult } from '../processes/process-runner.js'

const commandEvidenceBase = z.strictObject({
  commandIndex: z.number().int().nonnegative().safe(),
  command: VerificationCommandConfigurationSchema,
  status: z.enum(['passed', 'failed']),
  processStatus: z.enum(['exited', 'timed-out', 'failed-to-start']),
  exitCode: z.number().int().safe().nullable(),
  signal: z.string().trim().min(1).max(64).nullable(),
  errorCode: z.string().trim().min(1).max(128).optional(),
  durationMs: z.number().nonnegative().safe(),
  stdout: z.string().max(1_000_000),
  stderr: z.string().max(1_000_000),
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
})

export const VerificationCommandEvidenceSchema = commandEvidenceBase.superRefine(
  (value, context) => {
    const expectedStatus =
      value.processStatus === 'exited' && value.exitCode === 0 ? 'passed' : 'failed'
    const invalidExited = value.processStatus === 'exited' && value.errorCode !== undefined
    const invalidTimedOut =
      value.processStatus === 'timed-out' &&
      (value.exitCode !== null || value.errorCode !== undefined)
    const invalidStartFailure =
      value.processStatus === 'failed-to-start' &&
      (value.exitCode !== null || value.signal !== null || value.errorCode === undefined)
    if (
      value.status !== expectedStatus ||
      invalidExited ||
      invalidTimedOut ||
      invalidStartFailure
    ) {
      context.addIssue({ code: 'custom', message: 'Verification process evidence is inconsistent' })
    }
  },
)

export const RepositoryVerificationEvidenceSchema = z.strictObject({
  repositoryId: RepositoryIdSchema,
  profilePosition: z.number().int().nonnegative().safe(),
  status: z.enum(['passed', 'failed']),
  commands: z.array(VerificationCommandEvidenceSchema).max(32).readonly(),
})

export const VerificationOutputSchema = z.strictObject({
  recordedAt: z.iso.datetime({ offset: true }),
  repositories: z.array(RepositoryVerificationEvidenceSchema).min(1).max(32).readonly(),
  totals: z.strictObject({
    repositoryCount: z.number().int().positive().max(32).safe(),
    commandCount: z.number().int().nonnegative().max(1_024).safe(),
    passedCommandCount: z.number().int().nonnegative().max(1_024).safe(),
    failedCommandCount: z.number().int().nonnegative().max(1_024).safe(),
  }),
})

export type VerificationCommandEvidence = z.infer<typeof VerificationCommandEvidenceSchema>
export type RepositoryVerificationEvidence = z.infer<typeof RepositoryVerificationEvidenceSchema>
export type VerificationOutput = z.infer<typeof VerificationOutputSchema>

export interface VerificationCommandExecution {
  readonly commandIndex: number
  readonly command: VerificationCommandConfiguration
  readonly result: ProcessRunResult
}

export interface RepositoryVerificationExecution {
  readonly repositoryId: string
  readonly profilePosition: number
  readonly commands: readonly VerificationCommandExecution[]
}

export interface NormalizeVerificationEvidenceInput {
  readonly recordedAt: string
  readonly sensitiveValues: readonly string[]
  readonly repositories: readonly RepositoryVerificationExecution[]
}

export type VerificationEvidenceErrorCode = 'VERIFICATION_EVIDENCE_INVALID'

export class VerificationEvidenceError extends Error {
  override readonly name = 'VerificationEvidenceError'

  constructor(readonly code: VerificationEvidenceErrorCode) {
    super('Verification evidence is invalid or incomplete')
  }
}

const invalidEvidence = (): never => {
  throw new VerificationEvidenceError('VERIFICATION_EVIDENCE_INVALID')
}

const normalizeCommand = (
  execution: VerificationCommandExecution,
  redact: (value: string) => string,
): VerificationCommandEvidence => {
  const command = VerificationCommandConfigurationSchema.safeParse(execution.command)
  if (
    !command.success ||
    !Number.isSafeInteger(execution.commandIndex) ||
    execution.commandIndex < 0
  ) {
    return invalidEvidence()
  }
  const common = {
    commandIndex: execution.commandIndex,
    command: {
      executable: redact(command.data.executable),
      arguments: command.data.arguments.map(redact),
    },
    durationMs: execution.result.durationMs,
    stdout: redact(execution.result.stdout),
    stderr: redact(execution.result.stderr),
    stdoutTruncated: execution.result.stdoutTruncated,
    stderrTruncated: execution.result.stderrTruncated,
  }
  switch (execution.result.status) {
    case 'exited':
      return VerificationCommandEvidenceSchema.parse({
        ...common,
        status: execution.result.exitCode === 0 ? 'passed' : 'failed',
        processStatus: 'exited',
        exitCode: execution.result.exitCode,
        signal: execution.result.signal ?? null,
      })
    case 'timed-out':
      return VerificationCommandEvidenceSchema.parse({
        ...common,
        status: 'failed',
        processStatus: 'timed-out',
        exitCode: null,
        signal: execution.result.signal ?? null,
      })
    case 'failed-to-start':
      return VerificationCommandEvidenceSchema.parse({
        ...common,
        status: 'failed',
        processStatus: 'failed-to-start',
        exitCode: null,
        signal: null,
        errorCode: redact(execution.result.code),
      })
    case 'cancelled':
    case 'termination-unconfirmed':
      return invalidEvidence()
  }
}

export const normalizeVerificationEvidence = (
  input: NormalizeVerificationEvidenceInput,
): VerificationOutput => {
  const recordedAt = z.iso.datetime({ offset: true }).safeParse(input.recordedAt)
  if (
    !recordedAt.success ||
    input.repositories.length === 0 ||
    input.repositories.length > 32 ||
    new Set(input.repositories.map(({ repositoryId }) => repositoryId)).size !==
      input.repositories.length ||
    new Set(input.repositories.map(({ profilePosition }) => profilePosition)).size !==
      input.repositories.length
  ) {
    return invalidEvidence()
  }
  const redactor = createEventRedactor({ sensitiveValues: input.sensitiveValues })
  const repositories = input.repositories
    .map((repository) => {
      const repositoryId = RepositoryIdSchema.safeParse(repository.repositoryId)
      const commands = [...repository.commands].sort(
        (left, right) => left.commandIndex - right.commandIndex,
      )
      if (
        !repositoryId.success ||
        !Number.isSafeInteger(repository.profilePosition) ||
        repository.profilePosition < 0 ||
        commands.length > 32 ||
        commands.some(({ commandIndex }, index) => commandIndex !== index)
      ) {
        return invalidEvidence()
      }
      const evidence = commands.map((command) => normalizeCommand(command, redactor.redact))
      return RepositoryVerificationEvidenceSchema.parse({
        repositoryId: repositoryId.data,
        profilePosition: repository.profilePosition,
        status: evidence.every(({ status }) => status === 'passed') ? 'passed' : 'failed',
        commands: evidence,
      })
    })
    .sort((left, right) => left.profilePosition - right.profilePosition)
  const commands = repositories.flatMap((repository) => repository.commands)
  return VerificationOutputSchema.parse({
    recordedAt: recordedAt.data,
    repositories,
    totals: {
      repositoryCount: repositories.length,
      commandCount: commands.length,
      passedCommandCount: commands.filter(({ status }) => status === 'passed').length,
      failedCommandCount: commands.filter(({ status }) => status === 'failed').length,
    },
  })
}
