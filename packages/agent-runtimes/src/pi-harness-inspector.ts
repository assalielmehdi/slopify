import { access, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { spawn } from 'node:child_process'

import {
  HarnessDescriptorSchema,
  type HarnessDescriptor,
  type HarnessModelOption,
} from '@slopify/contracts'

const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024
const INSTALLATION_URL = 'https://pi.dev/'
const DESCRIPTION =
  'Runs workflow agents through the Pi CLI installed and configured on this machine.'
const DEPENDENCY_BIN_DIRECTORY = /(?:^|[\\/])node_modules[\\/]\.bin(?:[\\/]|$)/u

export const PI_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

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

export interface PiHarnessInspector {
  readonly harnessId: 'pi'
  inspect(): Promise<HarnessDescriptor>
}

export interface CreatePiHarnessInspectorOptions {
  readonly commandRunner?: HostCommandRunner
  readonly executable?: string
  readonly path?: string
  readonly resolveExecutable?: (
    executable: string,
    path: string | undefined,
  ) => Promise<string | undefined>
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

export const parsePiModelList = (stdout: string): readonly HarnessModelOption[] => {
  const models: HarnessModelOption[] = []
  const seen = new Set<string>()
  for (const line of stdout.split(/\r?\n/u)) {
    const columns = line.trim().split(/\s+/u)
    if (columns[1]?.toLowerCase() === 'model') continue
    const namespace = columns[0]
    const model = columns[1]
    const thinking = columns[4]
    if (namespace === undefined || model === undefined) continue
    const id = `${namespace}/${model}`
    if (id.length > 256) continue
    if (seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      name: id.slice(0, 128),
      thinkingLevels: thinking === 'yes' ? PI_THINKING_LEVELS : ['off'],
    })
    if (models.length === 512) break
  }
  return models
}

export const createPiHarnessInspector = (
  options: CreatePiHarnessInspectorOptions = {},
): PiHarnessInspector => {
  const commandRunner = options.commandRunner ?? createHostCommandRunner()
  const executable = options.executable ?? 'pi'
  const findExecutable = options.resolveExecutable ?? resolveExecutableOnPath
  const base = {
    harnessId: 'pi' as const,
    name: 'Pi' as const,
    description: DESCRIPTION,
    installHref: INSTALLATION_URL,
    installLabel: 'Install Pi',
    models: [] as readonly HarnessModelOption[],
  }

  return {
    harnessId: 'pi',
    async inspect() {
      const executablePath = await findExecutable(executable, options.path)
      if (executablePath === undefined) {
        return HarnessDescriptorSchema.parse({
          ...base,
          availability: 'UNAVAILABLE',
          unavailableReason: 'Pi is not installed or is not available on PATH.',
        })
      }

      let versionResult: HostCommandResult
      try {
        versionResult = await commandRunner.run({ executable: executablePath, args: ['--version'] })
      } catch {
        return HarnessDescriptorSchema.parse({
          ...base,
          availability: 'UNAVAILABLE',
          unavailableReason: 'Pi could not report its version.',
        })
      }
      const version = versionResult.stdout.trim()
      if (versionResult.exitCode !== 0 || version.length === 0 || version.length > 128) {
        return HarnessDescriptorSchema.parse({
          ...base,
          availability: 'UNAVAILABLE',
          unavailableReason: 'Pi could not report its version.',
        })
      }

      let modelsResult: HostCommandResult
      try {
        modelsResult = await commandRunner.run({
          executable: executablePath,
          args: ['--list-models'],
        })
      } catch {
        return HarnessDescriptorSchema.parse({
          ...base,
          availability: 'UNAVAILABLE',
          unavailableReason: 'Pi could not list its available models.',
        })
      }
      if (modelsResult.exitCode !== 0) {
        return HarnessDescriptorSchema.parse({
          ...base,
          availability: 'UNAVAILABLE',
          unavailableReason: 'Pi could not list its available models.',
        })
      }

      return HarnessDescriptorSchema.parse({
        ...base,
        availability: 'AVAILABLE',
        executablePath,
        version,
        models: parsePiModelList(modelsResult.stdout),
      })
    },
  }
}
