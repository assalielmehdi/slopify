import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, realpath } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'

const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024
const DEPENDENCY_BIN_DIRECTORY = /(?:^|[\\/])node_modules[\\/]\.bin(?:[\\/]|$)/u

export interface HostCommandInput {
  readonly executable: string
  readonly args: readonly string[]
}

export interface HostCommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface HostCommandRunner {
  run(input: HostCommandInput): Promise<HostCommandResult>
}

const collect = async (stream: NodeJS.ReadableStream): Promise<string> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    const remaining = MAX_COMMAND_OUTPUT_BYTES - size
    if (remaining <= 0) continue
    chunks.push(buffer.subarray(0, remaining))
    size += Math.min(buffer.byteLength, remaining)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export const createHostCommandRunner = (): HostCommandRunner => ({
  run(input) {
    return new Promise((resolve, reject) => {
      const child = spawn(input.executable, [...input.args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const stdout = collect(child.stdout)
      const stderr = collect(child.stderr)
      child.once('error', reject)
      child.once('close', (exitCode) => {
        void Promise.all([stdout, stderr]).then(([capturedStdout, capturedStderr]) => {
          resolve({ exitCode: exitCode ?? 1, stdout: capturedStdout, stderr: capturedStderr })
        }, reject)
      })
    })
  },
})

export const resolveExecutableOnPath = async (
  executable: string,
  path = process.env.PATH,
): Promise<string | undefined> => {
  if (isAbsolute(executable)) {
    try {
      await access(executable, constants.X_OK)
      return await realpath(executable)
    } catch {
      return undefined
    }
  }
  for (const directory of path?.split(delimiter) ?? []) {
    if (directory.length === 0 || DEPENDENCY_BIN_DIRECTORY.test(directory)) continue
    const candidate = join(directory, executable)
    try {
      await access(candidate, constants.X_OK)
      return await realpath(candidate)
    } catch {
      // Continue searching PATH.
    }
  }
  return undefined
}
