import {
  HarnessDescriptorSchema,
  HarnessThinkingLevelSchema,
  type HarnessDescriptor,
  type HarnessModelOption,
} from '@slopify/contracts'

import {
  createHostCommandRunner,
  resolveExecutableOnPath,
  type HostCommandResult,
  type HostCommandRunner,
} from './host-command.js'

const INSTALLATION_URL = 'https://developers.openai.com/codex/cli/'
const DESCRIPTION =
  'Runs workflow agents through the Codex CLI installed and configured on this machine.'

export interface CodexHarnessInspector {
  readonly harnessId: 'codex'
  inspect(): Promise<HarnessDescriptor>
}

export interface CreateCodexHarnessInspectorOptions {
  readonly commandRunner?: HostCommandRunner
  readonly executable?: string
  readonly path?: string
  readonly resolveExecutable?: (
    executable: string,
    path: string | undefined,
  ) => Promise<string | undefined>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const parseCodexModelCatalog = (stdout: string): readonly HarnessModelOption[] => {
  const parsed = JSON.parse(stdout) as unknown
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    throw new TypeError('Codex model catalog is invalid')
  }

  const models: HarnessModelOption[] = []
  const seen = new Set<string>()
  for (const candidate of parsed.models) {
    if (
      !isRecord(candidate) ||
      candidate.visibility !== 'list' ||
      typeof candidate.slug !== 'string' ||
      candidate.slug.trim().length === 0 ||
      candidate.slug.length > 256 ||
      typeof candidate.display_name !== 'string' ||
      candidate.display_name.trim().length === 0 ||
      candidate.display_name.length > 128 ||
      !Array.isArray(candidate.supported_reasoning_levels) ||
      seen.has(candidate.slug)
    ) {
      continue
    }
    const thinkingLevels = [
      ...new Set(
        candidate.supported_reasoning_levels.flatMap((level) => {
          if (!isRecord(level)) return []
          const parsedLevel = HarnessThinkingLevelSchema.safeParse(level.effort)
          return parsedLevel.success ? [parsedLevel.data] : []
        }),
      ),
    ]
    if (thinkingLevels.length === 0) continue
    seen.add(candidate.slug)
    models.push({
      id: candidate.slug,
      name: candidate.display_name,
      thinkingLevels,
    })
    if (models.length === 512) break
  }
  return models
}

const version = (result: HostCommandResult): string | undefined => {
  if (result.exitCode !== 0) return undefined
  const reported = result.stdout.trim().replace(/^codex-cli\s+/u, '')
  return reported.length > 0 && reported.length <= 128 ? reported : undefined
}

export const createCodexHarnessInspector = (
  options: CreateCodexHarnessInspectorOptions = {},
): CodexHarnessInspector => {
  const commandRunner = options.commandRunner ?? createHostCommandRunner()
  const executable = options.executable ?? 'codex'
  const findExecutable = options.resolveExecutable ?? resolveExecutableOnPath
  const base = {
    harnessId: 'codex' as const,
    name: 'Codex' as const,
    description: DESCRIPTION,
    installHref: INSTALLATION_URL,
    installLabel: 'Install Codex',
    models: [] as readonly HarnessModelOption[],
  }

  return {
    harnessId: 'codex',
    async inspect() {
      const executablePath = await findExecutable(executable, options.path)
      if (executablePath === undefined) {
        return HarnessDescriptorSchema.parse({
          ...base,
          availability: 'UNAVAILABLE',
          unavailableReason: 'Codex is not installed or is not available on PATH.',
        })
      }

      let versionResult: HostCommandResult
      try {
        versionResult = await commandRunner.run({ executable: executablePath, args: ['--version'] })
      } catch {
        return HarnessDescriptorSchema.parse({
          ...base,
          availability: 'UNAVAILABLE',
          unavailableReason: 'Codex could not report its version.',
        })
      }
      const reportedVersion = version(versionResult)
      if (reportedVersion === undefined) {
        return HarnessDescriptorSchema.parse({
          ...base,
          availability: 'UNAVAILABLE',
          unavailableReason: 'Codex could not report its version.',
        })
      }

      let models: readonly HarnessModelOption[]
      try {
        const modelsResult = await commandRunner.run({
          executable: executablePath,
          args: ['debug', 'models'],
        })
        if (modelsResult.exitCode !== 0) throw new Error('Codex model discovery failed')
        models = parseCodexModelCatalog(modelsResult.stdout)
      } catch {
        return HarnessDescriptorSchema.parse({
          ...base,
          availability: 'UNAVAILABLE',
          unavailableReason: 'Codex could not list its available models.',
        })
      }

      return HarnessDescriptorSchema.parse({
        ...base,
        availability: 'AVAILABLE',
        executablePath,
        version: reportedVersion,
        models,
      })
    },
  }
}
