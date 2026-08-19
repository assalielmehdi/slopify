import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type FauxProviderHandle,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'

import { createCompletionToolController } from '../../src/completion-tool.js'
import { AgentExecutionInputSchema, type AgentExecutionInput } from '../../src/contract.js'
import { createPiSdkAgentExecutor } from '../../src/pi-sdk-executor.js'
import type { LoadedResourceBundle } from '../../src/resource-loader.js'
import type { PiSession, PiSessionFactory } from '../../src/session-factory.js'
import { getAgentToolProfile } from '../../src/tool-profiles.js'

const secret = 'sk-integration-secret'
const rootPath = process.cwd()
const resourceBundle: LoadedResourceBundle = {
  bundleId: 'delivery.planning.v1',
  applicationVersion: '1.0.0',
  skills: [],
  promptFragments: [],
  contextFiles: [],
}

const createInput = (
  permissionProfile: 'read-only' | 'workspace-write',
  timeoutSeconds = 5,
): AgentExecutionInput =>
  AgentExecutionInputSchema.parse({
    executionId: `execution-${permissionProfile}`,
    runId: 'run-01',
    nodeId: 'plan',
    workspace: {
      rootPath,
      repositories: [
        {
          repositoryId: 'backend',
          path: `${rootPath}/packages/agent-runtimes`,
          access: permissionProfile,
        },
      ],
    },
    provider: 'faux',
    model: 'faux-model',
    thinkingLevel: 'high',
    permissionProfile,
    renderedPrompt: '# Plan\n\nComplete the bounded fixture.',
    declaredOutcomes: ['planned', 'blocked'],
    resourceBundleId: resourceBundle.bundleId,
    timeoutSeconds,
  })

const createResourceLoader = (): ResourceLoader => ({
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => undefined,
  getSystemPromptSource: () => undefined,
  getAppendSystemPrompt: () => [],
  getAppendSystemPromptSources: () => [],
  extendResources: () => undefined,
  reload: async () => undefined,
})

interface ActualSessionEvidence {
  activeTools: string[]
  sessionFile: string | undefined
  disposeCount: number
}

const createActualSessionFactory = (
  faux: FauxProviderHandle,
  evidence: ActualSessionEvidence,
): PiSessionFactory => ({
  async create({ input, outputSchema }) {
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    runtime.registerNativeProvider(faux.provider)
    const completion = createCompletionToolController({
      declaredOutcomes: input.declaredOutcomes,
      outputSchema,
    })
    const completionTool: ToolDefinition = {
      name: completion.tool.name,
      label: completion.tool.label,
      description: completion.tool.description,
      parameters: completion.tool.parameters,
      async execute(toolCallId, parameters, signal) {
        const result = await completion.tool.execute(toolCallId, parameters, signal)
        return { ...result, content: [...result.content] }
      },
    }
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
    })
    const created = await createAgentSession({
      cwd: input.workspace.rootPath,
      agentDir: input.workspace.rootPath,
      modelRuntime: runtime,
      model: faux.getModel(),
      thinkingLevel: 'high',
      tools: [...getAgentToolProfile(input.permissionProfile)],
      customTools: [completionTool],
      resourceLoader: createResourceLoader(),
      sessionManager: SessionManager.inMemory(input.workspace.rootPath),
      settingsManager,
    })
    const session = created.session
    evidence.activeTools = session.getActiveToolNames()
    evidence.sessionFile = session.sessionFile
    let disposed = false
    const wrapped: PiSession = {
      sessionId: session.sessionId,
      prompt: () => session.prompt(input.renderedPrompt, { expandPromptTemplates: false }),
      subscribe: (listener) => session.subscribe(listener),
      abort: () => session.abort(),
      waitForIdle: () => session.waitForIdle(),
      isIdle: () => session.isIdle,
      finish: () => completion.finish(),
      getUsage: () => {
        const { tokens } = session.getSessionStats()
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
        evidence.disposeCount += 1
        session.dispose()
      },
    }
    return wrapped
  },
})

const createActualExecutor = (faux: FauxProviderHandle, evidence: ActualSessionEvidence) =>
  createPiSdkAgentExecutor({
    sessionFactory: createActualSessionFactory(faux, evidence),
    resolveContext: async () => ({
      outputSchema: z.object({ sections: z.number().int().positive() }),
      resourceBundle,
    }),
    sensitiveValues: [secret],
  })

const collect = async <T>(iterable: AsyncIterable<T>): Promise<T[]> => {
  const values: T[] = []
  for await (const value of iterable) values.push(value)
  return values
}

const evidence = (): ActualSessionEvidence => ({
  activeTools: [],
  sessionFile: undefined,
  disposeCount: 0,
})

describe('Pi SDK executor with the offline faux provider', () => {
  it.each([
    ['read-only', ['read', 'grep', 'find', 'ls', 'complete_node']],
    ['workspace-write', ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'complete_node']],
  ] as const)(
    'completes one real %s session with ordered redacted events',
    async (profile, tools) => {
      const faux = fauxProvider({
        provider: 'faux',
        models: [{ id: 'faux-model', reasoning: true }],
      })
      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxThinking(`Hidden ${secret}`),
            fauxText(`Visible ${secret}`),
            fauxToolCall(
              'complete_node',
              {
                outcome: 'planned',
                summary: `Completed with ${secret}`,
                data: { sections: 3, credential: secret },
                artifacts: [],
                evidence: [],
              },
              { id: 'tool-complete-01' },
            ),
          ],
          { stopReason: 'toolUse' },
        ),
      ])
      const sessionEvidence = evidence()

      const events = await collect(
        createActualExecutor(faux, sessionEvidence).execute(createInput(profile)),
      )

      expect(sessionEvidence.activeTools).toEqual(tools)
      expect(sessionEvidence.sessionFile).toBeUndefined()
      expect(sessionEvidence.disposeCount).toBe(1)
      expect(events[0]?.type).toBe('AGENT_STARTED')
      expect(events[1]?.type).toBe('AGENT_SESSION_IDENTIFIED')
      expect(events.at(-1)?.type).toBe('AGENT_RESULT')
      expect(events.some(({ type }) => type === 'AGENT_MESSAGE')).toBe(true)
      expect(events.some(({ type }) => type === 'AGENT_TOOL_STARTED')).toBe(true)
      expect(events.some(({ type }) => type === 'AGENT_TOOL_COMPLETED')).toBe(true)
      expect(JSON.stringify(events)).not.toContain(secret)
      expect(JSON.stringify(events)).not.toContain('Hidden')
    },
  )

  it('maps a real faux-provider failure to one safe terminal event', async () => {
    const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-model' }] })
    faux.setResponses([
      async () => {
        throw new Error(secret)
      },
    ])
    const sessionEvidence = evidence()

    const events = await collect(
      createActualExecutor(faux, sessionEvidence).execute(createInput('read-only')),
    )

    expect(events.at(-1)).toMatchObject({
      type: 'AGENT_FAILED',
      data: { code: 'AGENT_SESSION_FAILED', message: 'Agent session failed' },
    })
    expect(events.filter(({ type }) => type === 'AGENT_FAILED')).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain(secret)
    expect(sessionEvidence.disposeCount).toBe(1)
  })

  it('normalizes a real tool failure before a successful completion', async () => {
    const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-model' }] })
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            'bash',
            { command: `printf '%s' '${secret}' >&2; exit 7` },
            { id: 'tool-bash-failed' },
          ),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(
        [
          fauxToolCall(
            'complete_node',
            {
              outcome: 'planned',
              summary: 'Recovered from the expected tool failure',
              data: { sections: 3 },
              artifacts: [],
              evidence: [],
            },
            { id: 'tool-complete-after-failure' },
          ),
        ],
        { stopReason: 'toolUse' },
      ),
    ])
    const sessionEvidence = evidence()

    const events = await collect(
      createActualExecutor(faux, sessionEvidence).execute(createInput('workspace-write')),
    )

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'AGENT_TOOL_COMPLETED',
        data: expect.objectContaining({
          toolCallId: 'tool-bash-failed',
          status: 'failed',
          content: expect.stringContaining('[REDACTED]'),
        }),
      }),
    )
    expect(events.at(-1)?.type).toBe('AGENT_RESULT')
    expect(JSON.stringify(events)).not.toContain(secret)
    expect(sessionEvidence.disposeCount).toBe(1)
  })

  it('cancels an active real bash tool and disposes the session', async () => {
    const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-model' }] })
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('bash', { command: 'sleep 10' }, { id: 'tool-bash-01' })],
        { stopReason: 'toolUse' },
      ),
    ])
    const sessionEvidence = evidence()
    const executor = createActualExecutor(faux, sessionEvidence)
    const iterator = executor.execute(createInput('workspace-write'))[Symbol.asyncIterator]()
    const events = []
    let event = await iterator.next()
    while (!event.done && event.value.type !== 'AGENT_TOOL_STARTED') {
      events.push(event.value)
      event = await iterator.next()
    }
    if (!event.done) events.push(event.value)

    await expect(executor.cancel(createInput('workspace-write').executionId)).resolves.toEqual({
      status: 'cancelled',
    })
    event = await iterator.next()
    while (!event.done) {
      events.push(event.value)
      event = await iterator.next()
    }

    expect(events.at(-1)?.type).toBe('AGENT_CANCELLED')
    expect(events.some(({ type }) => type === 'AGENT_TOOL_COMPLETED')).toBe(true)
    expect(sessionEvidence.disposeCount).toBe(1)
  })

  it('times out an active real bash tool and disposes the session', async () => {
    const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-model' }] })
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('bash', { command: 'sleep 10' }, { id: 'tool-bash-02' })],
        { stopReason: 'toolUse' },
      ),
    ])
    const sessionEvidence = evidence()

    const events = await collect(
      createActualExecutor(faux, sessionEvidence).execute(createInput('workspace-write', 1)),
    )

    expect(events.at(-1)).toMatchObject({
      type: 'AGENT_FAILED',
      data: { code: 'AGENT_TIMEOUT' },
    })
    expect(events.some(({ type }) => type === 'AGENT_TOOL_COMPLETED')).toBe(true)
    expect(sessionEvidence.disposeCount).toBe(1)
  })
})
