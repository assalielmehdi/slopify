import { StringDecoder } from 'node:string_decoder'
import { execa } from 'execa'

import { confirmProcessGroupExit } from './process-group.js'

export interface ProcessRunInput {
  readonly executable: string
  readonly arguments: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

interface ProcessEvidence {
  readonly durationMs: number
  readonly stdout: string
  readonly stderr: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
}

interface TerminatedProcessEvidence extends ProcessEvidence {
  readonly signal: NodeJS.Signals | undefined
}

export type ProcessRunResult =
  | (ProcessEvidence &
      Readonly<{
        status: 'exited'
        exitCode: number | null
        signal: NodeJS.Signals | undefined
      }>)
  | (TerminatedProcessEvidence & Readonly<{ status: 'cancelled' | 'timed-out' }>)
  | (TerminatedProcessEvidence &
      Readonly<{
        status: 'termination-unconfirmed'
        reason: 'cancelled' | 'timed-out'
      }>)
  | (ProcessEvidence &
      Readonly<{
        status: 'failed-to-start'
        code: string
        message: 'Process could not be started'
      }>)

export interface ProcessRunner {
  run(input: ProcessRunInput): Promise<ProcessRunResult>
}

export interface CreateProcessRunnerOptions {
  readonly maxOutputBytes: number
  readonly redactedValues?: readonly string[]
  readonly forceKillAfterMs?: number
  readonly terminationConfirmationTimeoutMs?: number
}

class BoundedRedactedOutput {
  readonly #decoder = new StringDecoder('utf8')
  readonly #maxOutputBytes: number
  readonly #redactedValues: readonly string[]
  readonly #maximumRedactedValueLength: number
  readonly #chunks: Buffer[] = []
  #pending = ''
  #retainedBytes = 0
  #truncated = false

  constructor(maxOutputBytes: number, redactedValues: readonly string[]) {
    this.#maxOutputBytes = maxOutputBytes
    this.#redactedValues = [...new Set(redactedValues.filter((value) => value.length > 0))].sort(
      (left, right) => right.length - left.length,
    )
    this.#maximumRedactedValueLength = Math.max(
      1,
      ...this.#redactedValues.map((value) => value.length),
    )
  }

  add(chunk: Buffer | string): void {
    if (this.#truncated) return
    const decoded = typeof chunk === 'string' ? chunk : this.#decoder.write(chunk)
    this.#pending += decoded
    this.#drain(false)
  }

  finish(): Readonly<{ value: string; truncated: boolean }> {
    if (!this.#truncated) {
      this.#pending += this.#decoder.end()
      this.#drain(true)
    }
    return { value: Buffer.concat(this.#chunks).toString('utf8'), truncated: this.#truncated }
  }

  #drain(final: boolean): void {
    const retainedTailLength = final ? 0 : this.#maximumRedactedValueLength - 1
    while (this.#pending.length > retainedTailLength) {
      const redactedValue = this.#redactedValues.find((value) => this.#pending.startsWith(value))
      if (redactedValue !== undefined) {
        this.#pending = this.#pending.slice(redactedValue.length)
        this.#append('[REDACTED]')
      } else {
        const codePoint = this.#pending.codePointAt(0)
        if (codePoint === undefined) return
        const character = String.fromCodePoint(codePoint)
        this.#pending = this.#pending.slice(character.length)
        this.#append(character)
      }
      if (this.#truncated) {
        this.#pending = ''
        return
      }
    }
  }

  #append(value: string): void {
    const bytes = Buffer.from(value)
    if (this.#retainedBytes + bytes.length > this.#maxOutputBytes) {
      this.#truncated = true
      return
    }
    this.#chunks.push(bytes)
    this.#retainedBytes += bytes.length
  }
}

const isPositiveSafeInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0

const processEvidence = (
  durationMs: number,
  stdout: BoundedRedactedOutput,
  stderr: BoundedRedactedOutput,
): ProcessEvidence => {
  const stdoutResult = stdout.finish()
  const stderrResult = stderr.finish()
  return {
    durationMs,
    stdout: stdoutResult.value,
    stderr: stderrResult.value,
    stdoutTruncated: stdoutResult.truncated,
    stderrTruncated: stderrResult.truncated,
  }
}

export const createProcessRunner = (options: CreateProcessRunnerOptions): ProcessRunner => {
  if (!isPositiveSafeInteger(options.maxOutputBytes)) {
    throw new TypeError('maxOutputBytes must be a positive safe integer')
  }
  const forceKillAfterMs = options.forceKillAfterMs ?? 5_000
  const terminationConfirmationTimeoutMs = options.terminationConfirmationTimeoutMs ?? 1_000
  if (!isPositiveSafeInteger(forceKillAfterMs)) {
    throw new TypeError('forceKillAfterMs must be a positive safe integer')
  }
  if (!isPositiveSafeInteger(terminationConfirmationTimeoutMs)) {
    throw new TypeError('terminationConfirmationTimeoutMs must be a positive safe integer')
  }
  const redactedValues = options.redactedValues ?? []

  return {
    async run(input) {
      if (!isPositiveSafeInteger(input.timeoutMs)) {
        throw new TypeError('timeoutMs must be a positive safe integer')
      }
      if (input.signal?.aborted === true) {
        return {
          status: 'cancelled',
          signal: undefined,
          durationMs: 0,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        }
      }

      const stdout = new BoundedRedactedOutput(options.maxOutputBytes, redactedValues)
      const stderr = new BoundedRedactedOutput(options.maxOutputBytes, redactedValues)
      const subprocess = execa(input.executable, [...input.arguments], {
        cwd: input.cwd,
        timeout: input.timeoutMs,
        ...(input.signal === undefined ? {} : { cancelSignal: input.signal }),
        reject: false,
        shell: false,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        buffer: false,
        cleanup: true,
        killDescendants: true,
        forceKillAfterDelay: forceKillAfterMs,
      })
      const processId = subprocess.pid
      subprocess.stdout.on('data', (chunk: Buffer | string) => stdout.add(chunk))
      subprocess.stderr.on('data', (chunk: Buffer | string) => stderr.add(chunk))

      const result = await subprocess
      const evidence = processEvidence(result.durationMs, stdout, stderr)
      const signal = result.signal as NodeJS.Signals | undefined
      const terminationReason = result.isCanceled
        ? ('cancelled' as const)
        : result.timedOut
          ? ('timed-out' as const)
          : undefined

      if (terminationReason !== undefined) {
        const terminationConfirmed =
          processId === undefined ||
          (await confirmProcessGroupExit(processId, terminationConfirmationTimeoutMs))
        if (!terminationConfirmed) {
          return {
            ...evidence,
            status: 'termination-unconfirmed',
            reason: terminationReason,
            signal,
          }
        }
        return { ...evidence, status: terminationReason, signal }
      }

      if (result.exitCode !== undefined || result.signal !== undefined) {
        return {
          ...evidence,
          status: 'exited',
          exitCode: result.exitCode ?? null,
          signal,
        }
      }

      return {
        ...evidence,
        status: 'failed-to-start',
        code: result.code ?? 'PROCESS_START_FAILED',
        message: 'Process could not be started',
      }
    },
  }
}
