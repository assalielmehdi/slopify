import { isAbsolute, relative } from 'node:path'

import {
  createExtensionRuntime,
  createAgentSession,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
  type Skill,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { CredentialStore } from '@earendil-works/pi-ai'
import { z } from 'zod'

import { createCompletionToolController } from './completion-tool.js'
import {
  AgentExecutionInputSchema,
  type AgentExecutionInput,
  type AgentNodeResult,
} from './contract.js'
import { createScopedModelRuntime, type ModelCredentialSource } from './model-runtime.js'
import type { LoadedResourceBundle } from './resource-loader.js'
import { getAgentToolProfile } from './tool-profiles.js'

const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export type PiSessionFactoryErrorCode =
  'PI_SESSION_CONFIGURATION_INVALID' | 'PI_SESSION_CREATION_FAILED' | 'PI_SESSION_PERSISTED'

const messages: Readonly<Record<PiSessionFactoryErrorCode, string>> = {
  PI_SESSION_CONFIGURATION_INVALID: 'Pi session configuration is invalid',
  PI_SESSION_CREATION_FAILED: 'Pi session could not be created',
  PI_SESSION_PERSISTED: 'Pi session unexpectedly enabled persistence',
}

export class PiSessionFactoryError extends Error {
  override readonly name = 'PiSessionFactoryError'

  constructor(readonly code: PiSessionFactoryErrorCode) {
    super(messages[code])
  }
}

export interface PiSessionUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

export interface PiSession {
  readonly sessionId: string
  prompt(): Promise<void>
  subscribe(listener: (event: unknown) => void): () => void
  abort(): Promise<void>
  waitForIdle(): Promise<void>
  isIdle(): boolean
  finish(): AgentNodeResult
  getUsage(): PiSessionUsage
  dispose(): void
}

export interface CreatePiSessionInput {
  readonly input: AgentExecutionInput
  readonly outputSchema: z.ZodType<unknown>
  readonly resourceBundle: LoadedResourceBundle
  readonly sandbox?: Readonly<{
    workspaceRoot: string
    tools: readonly ToolDefinition[]
    skills: readonly Skill[]
  }>
}

export interface PiSessionFactory {
  create(options: CreatePiSessionInput): Promise<PiSession>
}

export interface CreatePiSessionFactoryOptions {
  readonly credentialSource?: ModelCredentialSource
  readonly credentialStore?: CredentialStore
}

const isChildPath = (parent: string, child: string): boolean => {
  const relativePath = relative(parent, child)
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith('../') &&
    !isAbsolute(relativePath)
  )
}

const validateResources = (
  input: AgentExecutionInput,
  resourceBundle: LoadedResourceBundle,
): void => {
  if (resourceBundle.bundleId !== input.resourceBundleId) {
    throw new PiSessionFactoryError('PI_SESSION_CONFIGURATION_INVALID')
  }
  const repositories = new Map<string, string>(
    input.workspace.repositories.map((repository) => [repository.repositoryId, repository.path]),
  )
  for (const file of resourceBundle.contextFiles) {
    const repositoryPath = repositories.get(file.repositoryId)
    if (repositoryPath === undefined || !isChildPath(repositoryPath, file.path)) {
      throw new PiSessionFactoryError('PI_SESSION_CONFIGURATION_INVALID')
    }
  }
}

const createResourceLoader = (
  resourceBundle: LoadedResourceBundle,
  sandbox?: CreatePiSessionInput['sandbox'],
): ResourceLoader => {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() }
  const agentsFiles =
    sandbox === undefined
      ? resourceBundle.contextFiles.map(({ path, content }) => ({ path, content }))
      : []
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [...(sandbox?.skills ?? [])], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles }),
    getSystemPrompt: () => undefined,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => undefined,
    reload: async () => undefined,
  }
}

export const createPiSessionFactory = (
  options: CreatePiSessionFactoryOptions,
): PiSessionFactory => ({
  async create(createOptions) {
    const parsedInput = AgentExecutionInputSchema.safeParse(createOptions.input)
    if (
      !parsedInput.success ||
      !THINKING_LEVELS.has(parsedInput.data.thinkingLevel) ||
      typeof createOptions.outputSchema?.safeParse !== 'function'
    ) {
      throw new PiSessionFactoryError('PI_SESSION_CONFIGURATION_INVALID')
    }
    validateResources(parsedInput.data, createOptions.resourceBundle)
    const sandbox = createOptions.sandbox
    if (sandbox !== undefined) {
      const toolNames = sandbox.tools.map(({ name }) => name)
      if (
        sandbox.workspaceRoot !== '/workspace' ||
        toolNames.length !== 4 ||
        !['read', 'bash', 'edit', 'write'].every((name) => toolNames.includes(name)) ||
        sandbox.skills.some(
          ({ filePath, baseDir }) =>
            !filePath.startsWith('/skills/') || !baseDir.startsWith('/skills/'),
        )
      ) {
        throw new PiSessionFactoryError('PI_SESSION_CONFIGURATION_INVALID')
      }
    }

    const { runtime, model } = await createScopedModelRuntime({
      provider: parsedInput.data.provider,
      model: parsedInput.data.model,
      ...(options.credentialSource === undefined
        ? { credentialStore: options.credentialStore as CredentialStore }
        : { credentialSource: options.credentialSource }),
    })
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
      packages: [],
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
      enableAnalytics: false,
      enableInstallTelemetry: false,
    })
    const workspaceRoot = sandbox?.workspaceRoot ?? parsedInput.data.workspace.rootPath
    const sessionManager = SessionManager.inMemory(workspaceRoot)
    const resourceLoader = createResourceLoader(createOptions.resourceBundle, sandbox)

    const completion = createCompletionToolController({
      declaredOutcomes: parsedInput.data.declaredOutcomes,
      outputSchema: createOptions.outputSchema,
    })
    const completionTool: ToolDefinition = {
      name: completion.tool.name,
      label: completion.tool.label,
      description: completion.tool.description,
      parameters: completion.tool.parameters,
      async execute(toolCallId, parameters, signal) {
        const result = await completion.tool.execute(toolCallId, parameters, signal)
        return {
          content: [...result.content],
          details: result.details,
          terminate: result.terminate,
        }
      },
    }
    const tools =
      sandbox === undefined
        ? [...getAgentToolProfile(parsedInput.data.permissionProfile)]
        : [...sandbox.tools.map(({ name }) => name), 'complete_node']

    let sdkSession
    try {
      const created = await createAgentSession({
        cwd: workspaceRoot,
        agentDir: workspaceRoot,
        modelRuntime: runtime,
        model,
        thinkingLevel: parsedInput.data.thinkingLevel as
          'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max',
        tools,
        customTools: [...(sandbox?.tools ?? []), completionTool],
        resourceLoader,
        sessionManager,
        settingsManager,
      })
      sdkSession = created.session
    } catch {
      throw new PiSessionFactoryError('PI_SESSION_CREATION_FAILED')
    }

    if (sdkSession.sessionFile !== undefined) {
      sdkSession.dispose()
      throw new PiSessionFactoryError('PI_SESSION_PERSISTED')
    }

    let disposed = false
    return {
      sessionId: sdkSession.sessionId,
      prompt: () =>
        sdkSession.prompt(parsedInput.data.renderedPrompt, { expandPromptTemplates: false }),
      subscribe: (listener) => sdkSession.subscribe(listener),
      abort: () => sdkSession.abort(),
      waitForIdle: () => sdkSession.waitForIdle(),
      isIdle: () => sdkSession.isIdle,
      finish: () => completion.finish(),
      getUsage: () => {
        const { tokens } = sdkSession.getSessionStats()
        return {
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          cacheReadTokens: tokens.cacheRead,
          cacheWriteTokens: tokens.cacheWrite,
        }
      },
      dispose() {
        if (disposed) return
        disposed = true
        sdkSession.dispose()
      },
    }
  },
})
