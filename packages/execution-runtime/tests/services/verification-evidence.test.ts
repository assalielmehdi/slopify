import { describe, expect, it } from 'vitest'

import {
  VerificationEvidenceError,
  VerificationOutputSchema,
  normalizeVerificationEvidence,
  type ProcessRunResult,
} from '../../src/index.js'

const exited = (exitCode: number, stdout: string, stderr = ''): ProcessRunResult => ({
  status: 'exited',
  exitCode,
  signal: undefined,
  durationMs: 12,
  stdout,
  stderr,
  stdoutTruncated: false,
  stderrTruncated: false,
})

describe('verification evidence normalization', () => {
  it('orders complete repository records and redacts each retained output stream', () => {
    const secret = 'provider-secret'

    const output = normalizeVerificationEvidence({
      recordedAt: '2026-08-19T13:00:00Z',
      sensitiveValues: [secret],
      repositories: [
        { repositoryId: 'docs', profilePosition: 2, commands: [] },
        {
          repositoryId: 'api',
          profilePosition: 0,
          commands: [
            {
              commandIndex: 1,
              command: { executable: 'pnpm', arguments: ['lint'] },
              result: exited(2, `token=${secret}`, `Authorization: Bearer ${secret}`),
            },
            {
              commandIndex: 0,
              command: { executable: 'pnpm', arguments: ['test', '--runInBand'] },
              result: exited(0, '42 tests passed'),
            },
          ],
        },
      ],
    })

    expect(VerificationOutputSchema.parse(output)).toEqual(output)
    expect(output).toEqual({
      recordedAt: '2026-08-19T13:00:00Z',
      repositories: [
        {
          repositoryId: 'api',
          profilePosition: 0,
          status: 'failed',
          commands: [
            {
              commandIndex: 0,
              command: { executable: 'pnpm', arguments: ['test', '--runInBand'] },
              status: 'passed',
              processStatus: 'exited',
              exitCode: 0,
              signal: null,
              durationMs: 12,
              stdout: '42 tests passed',
              stderr: '',
              stdoutTruncated: false,
              stderrTruncated: false,
            },
            {
              commandIndex: 1,
              command: { executable: 'pnpm', arguments: ['lint'] },
              status: 'failed',
              processStatus: 'exited',
              exitCode: 2,
              signal: null,
              durationMs: 12,
              stdout: 'token=[REDACTED]',
              stderr: 'Authorization: Bearer [REDACTED]',
              stdoutTruncated: false,
              stderrTruncated: false,
            },
          ],
        },
        {
          repositoryId: 'docs',
          profilePosition: 2,
          status: 'passed',
          commands: [],
        },
      ],
      totals: {
        repositoryCount: 2,
        commandCount: 2,
        passedCommandCount: 1,
        failedCommandCount: 1,
      },
    })
    expect(JSON.stringify(output)).not.toContain(secret)
  })

  it('rejects duplicate command records instead of hiding missing evidence', () => {
    expect(() =>
      normalizeVerificationEvidence({
        recordedAt: '2026-08-19T13:00:00Z',
        sensitiveValues: [],
        repositories: [
          {
            repositoryId: 'api',
            profilePosition: 0,
            commands: [
              {
                commandIndex: 0,
                command: { executable: 'pnpm', arguments: ['test'] },
                result: exited(0, 'passed'),
              },
              {
                commandIndex: 0,
                command: { executable: 'pnpm', arguments: ['lint'] },
                result: exited(0, 'passed'),
              },
            ],
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<VerificationEvidenceError>>({
        code: 'VERIFICATION_EVIDENCE_INVALID',
      }),
    )
  })

  it('maps schema failures to the stable evidence error contract', () => {
    expect(() =>
      normalizeVerificationEvidence({
        recordedAt: '2026-08-19T13:00:00Z',
        sensitiveValues: [],
        repositories: [
          {
            repositoryId: 'api',
            profilePosition: 0,
            commands: [
              {
                commandIndex: 0,
                command: { executable: 'pnpm', arguments: ['test'] },
                result: exited(0, 'x'.repeat(1_000_001)),
              },
            ],
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<VerificationEvidenceError>>({
        code: 'VERIFICATION_EVIDENCE_INVALID',
      }),
    )
  })
})
