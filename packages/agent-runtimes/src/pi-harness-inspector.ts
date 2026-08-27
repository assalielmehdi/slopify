import {
  HarnessDescriptorSchema,
  type HarnessDescriptor,
  type HarnessModelOption,
} from '@slopify/contracts'

import {
  createHostCommandRunner,
  resolveExecutableOnPath,
  type HostCommandResult,
  type HostCommandRunner,
} from './host-command.js'

export {
  createHostCommandRunner,
  resolveExecutableOnPath,
  type HostCommandInput,
  type HostCommandResult,
  type HostCommandRunner,
} from './host-command.js'

const INSTALLATION_URL = 'https://pi.dev/'
const DESCRIPTION =
  'Runs workflow agents through the Pi CLI installed and configured on this machine.'

export const PI_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

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
