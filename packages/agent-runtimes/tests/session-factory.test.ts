import { z } from 'zod'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Type } from 'typebox'

import { AgentExecutionInputSchema } from '../src/contract.js'
import type { ModelCredentialSource } from '../src/model-runtime.js'
import { loadResourceBundle } from '../src/resource-loader.js'
import { createPiSessionFactory, PiSessionFactoryError } from '../src/session-factory.js'

const { createAgentSessionMock } = vi.hoisted(() => ({
  createAgentSessionMock: vi.fn(),
}))

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()),
  createAgentSession: createAgentSessionMock,
}))

const input = AgentExecutionInputSchema.parse({
  executionId: 'execution-01',
  runId: 'run-01',
  nodeId: 'plan',
  workspace: {
    rootPath: '/workspaces/run-01',
    repositories: [
      {
        repositoryId: 'backend',
        path: '/workspaces/run-01/backend',
        access: 'read-only',
      },
    ],
  },
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  thinkingLevel: 'high',
  permissionProfile: 'read-only',
  renderedPrompt: '# Plan\n\nInspect the explicit workspace.',
  declaredOutcomes: ['planned', 'blocked'],
  resourceBundleId: 'delivery.planning.v1',
  timeoutSeconds: 600,
})

const resourceBundle = loadResourceBundle({
  bundleId: 'delivery.planning.v1',
  bundles: [
    {
      bundleId: 'delivery.planning.v1',
      applicationVersion: '1.0.0',
      skills: [{ name: 'planning', description: 'Plan bounded work', content: '# Planning' }],
      promptFragments: [{ name: 'guardrails', content: 'Stay in scope.' }],
    },
  ],
  workspaceRepositories: [{ repositoryId: 'backend', path: '/workspaces/run-01/backend' }],
  contextFiles: [
    {
      repositoryId: 'backend',
      path: '/workspaces/run-01/backend/AGENTS.md',
      content: '# Instructions',
    },
  ],
})

const credentialSource: ModelCredentialSource = {
  async read(provider) {
    return provider === 'anthropic' ? { type: 'api-key', key: 'test-key' } : undefined
  },
}

const createSdkSession = (sessionId: string, sessionFile?: string) => {
  let idle = true
  return {
    sessionId,
    sessionFile,
    prompt: vi.fn(async () => undefined),
    subscribe: vi.fn(() => vi.fn()),
    abort: vi.fn(async () => {
      idle = true
    }),
    waitForIdle: vi.fn(async () => undefined),
    get isIdle() {
      return idle
    },
    dispose: vi.fn(),
    getSessionStats: vi.fn(() => ({
      tokens: { input: 11, output: 7, cacheRead: 3, cacheWrite: 2, total: 23 },
    })),
  }
}

describe('Pi session factory', () => {
  beforeEach(() => {
    createAgentSessionMock.mockReset()
  })

  it('constructs a fresh isolated session with exact tools, resources, and settings', async () => {
    const firstSdkSession = createSdkSession('session-01')
    const secondSdkSession = createSdkSession('session-02')
    createAgentSessionMock
      .mockResolvedValueOnce({ session: firstSdkSession, extensionsResult: {} })
      .mockResolvedValueOnce({ session: secondSdkSession, extensionsResult: {} })
    const factory = createPiSessionFactory({ credentialSource })

    const first = await factory.create({
      input,
      outputSchema: z.object({ sections: z.number().int().positive() }),
      resourceBundle,
    })
    const second = await factory.create({
      input,
      outputSchema: z.object({ sections: z.number().int().positive() }),
      resourceBundle,
    })

    expect(createAgentSessionMock).toHaveBeenCalledTimes(2)
    const firstOptions = createAgentSessionMock.mock.calls[0]?.[0]
    const secondOptions = createAgentSessionMock.mock.calls[1]?.[0]
    expect(firstOptions).toMatchObject({
      cwd: '/workspaces/run-01',
      agentDir: '/workspaces/run-01',
      thinkingLevel: 'high',
      tools: ['read', 'grep', 'find', 'ls', 'complete_node'],
    })
    expect(firstOptions.sessionManager).not.toBe(secondOptions.sessionManager)
    expect(firstOptions.settingsManager).not.toBe(secondOptions.settingsManager)
    expect(firstOptions.modelRuntime).not.toBe(secondOptions.modelRuntime)
    expect(firstOptions.sessionManager.isPersisted()).toBe(false)
    expect(firstOptions.settingsManager.getGlobalSettings()).toMatchObject({
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
    expect(firstOptions.resourceLoader.getAgentsFiles()).toEqual({
      agentsFiles: [
        {
          path: '/workspaces/run-01/backend/AGENTS.md',
          content: '# Instructions',
        },
      ],
    })
    expect(firstOptions.resourceLoader.getSkills()).toMatchObject({ skills: [] })
    expect(firstOptions.resourceLoader.getPrompts()).toMatchObject({ prompts: [] })
    expect(firstOptions.resourceLoader.getExtensions()).toMatchObject({
      extensions: [],
      errors: [],
    })
    expect(firstOptions.resourceLoader.getSystemPrompt()).toBeUndefined()
    expect(firstOptions.resourceLoader.getAppendSystemPrompt()).toEqual([])
    expect(firstOptions.customTools.map((tool: { name: string }) => tool.name)).toEqual([
      'complete_node',
    ])
    await expect(firstOptions.modelRuntime.listCredentials()).resolves.toEqual([
      { providerId: 'anthropic', type: 'api_key' },
    ])
    expect(firstOptions.model).toMatchObject({
      provider: 'anthropic',
      id: 'claude-sonnet-4-5',
    })

    await first.prompt()
    expect(firstSdkSession.prompt).toHaveBeenCalledWith(input.renderedPrompt, {
      expandPromptTemplates: false,
    })
    expect(first.getUsage()).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    })
    first.dispose()
    first.dispose()
    second.dispose()
    expect(firstSdkSession.dispose).toHaveBeenCalledTimes(1)
    expect(secondSdkSession.dispose).toHaveBeenCalledTimes(1)
  })

  it('rejects any unexpectedly persisted SDK session and disposes it', async () => {
    const sdkSession = createSdkSession('session-persisted', '/tmp/session.jsonl')
    createAgentSessionMock.mockResolvedValue({ session: sdkSession, extensionsResult: {} })
    const factory = createPiSessionFactory({ credentialSource })

    await expect(
      factory.create({ input, outputSchema: z.unknown(), resourceBundle }),
    ).rejects.toMatchObject<PiSessionFactoryError>({ code: 'PI_SESSION_PERSISTED' })
    expect(sdkSession.dispose).toHaveBeenCalledTimes(1)
  })

  it('passes the exact workspace-write allowlist without caller-selected tools', async () => {
    createAgentSessionMock.mockResolvedValue({
      session: createSdkSession('session-write'),
      extensionsResult: {},
    })
    const factory = createPiSessionFactory({ credentialSource })
    const writeInput = AgentExecutionInputSchema.parse({
      ...input,
      permissionProfile: 'workspace-write',
      workspace: {
        ...input.workspace,
        repositories: input.workspace.repositories.map((repository) => ({
          ...repository,
          access: 'workspace-write',
        })),
      },
    })

    const session = await factory.create({
      input: writeInput,
      outputSchema: z.unknown(),
      resourceBundle,
    })

    expect(createAgentSessionMock.mock.calls[0]?.[0].tools).toEqual([
      'read',
      'bash',
      'edit',
      'write',
      'grep',
      'find',
      'ls',
      'complete_node',
    ])
    session.dispose()
  })

  it('rejects resources that do not match the execution workspace before SDK creation', async () => {
    const factory = createPiSessionFactory({ credentialSource })

    await expect(
      factory.create({
        input,
        outputSchema: z.unknown(),
        resourceBundle: { ...resourceBundle, bundleId: 'another.bundle' },
      }),
    ).rejects.toMatchObject<PiSessionFactoryError>({ code: 'PI_SESSION_CONFIGURATION_INVALID' })
    expect(createAgentSessionMock).not.toHaveBeenCalled()
  })

  it('uses only the Gondolin-backed tools and revision-pinned skills when sandboxed', async () => {
    createAgentSessionMock.mockResolvedValue({
      session: createSdkSession('session-sandboxed'),
      extensionsResult: {},
    })
    const factory = createPiSessionFactory({ credentialSource })
    const guestTool = (name: string) => ({
      name,
      label: name,
      description: name,
      parameters: Type.Object({}),
      execute: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })),
    })
    const tools = ['read', 'bash', 'edit', 'write'].map(guestTool)
    const skills = [
      {
        name: 'gitlab-delivery',
        description: 'Use GitLab safely',
        filePath: '/skills/gitlab-delivery/SKILL.md',
        baseDir: '/skills/gitlab-delivery',
        sourceInfo: {
          path: '/skills/gitlab-delivery/SKILL.md',
          source: 'slopify-snapshot',
          scope: 'temporary' as const,
          origin: 'top-level' as const,
        },
        disableModelInvocation: false,
      },
    ]

    const session = await factory.create({
      input,
      outputSchema: z.unknown(),
      resourceBundle,
      sandbox: { workspaceRoot: '/workspace', tools, skills },
    })

    const options = createAgentSessionMock.mock.calls[0]?.[0]
    expect(options.cwd).toBe('/workspace')
    expect(options.agentDir).toBe('/workspace')
    expect(options.tools).toEqual(['read', 'bash', 'edit', 'write', 'complete_node'])
    expect(options.customTools.map(({ name }: { name: string }) => name)).toEqual([
      'read',
      'bash',
      'edit',
      'write',
      'complete_node',
    ])
    expect(options.resourceLoader.getSkills()).toEqual({ skills, diagnostics: [] })
    expect(options.resourceLoader.getAgentsFiles()).toEqual({ agentsFiles: [] })
    session.dispose()
  })
})
